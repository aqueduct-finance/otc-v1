import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits, encodeAbiParameters, keccak256 } from "viem";
import hre from "hardhat";
import orderType from "./utils/orderType";
import { seaportAddress, zeroAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";
import lockupFixture from "./fixtures/lockupFixture";

describe("TokenLockupPlansHandler tests", function () {
  async function fixture() {
    const sf = await seaportFixture();
    const af = await accountsFixture();
    const lf = await lockupFixture();

    const lockupHandler = await hre.viem.deployContract(
      "TokenLockupPlansHandler",
      [lf.lockup.address, sf.seaport.address]
    );

    return {
      ...sf,
      ...af,
      ...lf,
      lockupHandler,
    };
  }

  describe("erc20<->erc20", function () {
    /*
      Test a swap with the TokenLockupPlansHandler
      This will swap the tokens, and atomically deposit them into lockup nfts
    */
    it("TokenLockupPlansHandler swaps correctly and creates token locks (lock both sides)", async function () {
      const {
        alice,
        bob,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        lockupHandler,
        lockup,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob can fill the trade
      // alice and bob approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // alice and bob also have to approve the lockup handler for the opposite token
      // bc lockups are created atomically post-trade
      await (
        await getWeth(alice)
      ).write.approve([lockupHandler.address, wethTradeamount]);
      await (
        await getUsdc(bob)
      ).write.approve([lockupHandler.address, usdcTradeAmount]);

      // construct order
      const salt = generateSalt();
      const encodedLockParams = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              {
                name: "offerLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
              {
                name: "considerationLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
            ],
          },
        ],
        [
          {
            offerLockupParams: {
              start: timestamp + 500n,
              cliff: timestamp + 1000n,
              rate: 1000n,
              period: 1n,
            },
            considerationLockupParams: {
              start: timestamp + 500n,
              cliff: timestamp + 1000n,
              rate: 1000n,
              period: 1n,
            },
          },
        ]
      );
      const hashedLockParams = keccak256(encodedLockParams);
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: lockupHandler.address, // don't forget this

        // this is what the trader is giving
        offer: [
          {
            itemType: 1, // 1 == erc20
            token: usdc.address,
            identifierOrCriteria: 0n, // criteria not used for erc20s
            startAmount: usdcTradeAmount,
            endAmount: usdcTradeAmount,
          },
        ],

        // what the trader expects to receive
        consideration: [
          {
            itemType: 1,
            token: weth.address,
            identifierOrCriteria: 0n,
            startAmount: wethTradeamount,
            endAmount: wethTradeamount,
            recipient: alice.account.address,
          },
        ],
        orderType: 2, // full restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: hashedLockParams,
        salt: salt,
        conduitKey: zeroHash, // not using a conduit
      };
      const orderParameters = {
        ...baseOrderParameters,
        totalOriginalConsiderationItems: 1n,
      };

      // get contract info
      const info = await seaport.read.information();
      const version = info[0];
      const name = await seaport.read.name();
      const domainData = {
        name: name,
        version: version,

        // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
        chainId: 31337,
        verifyingContract: seaportAddress,
      };
      const counter = await seaport.read.getCounter([alice.account.address]);
      const orderComponents = {
        ...baseOrderParameters,
        counter: counter,
      };

      // alice signs the order
      const signature = await alice.signTypedData({
        domain: domainData,
        types: orderType,
        primaryType: "OrderComponents",
        message: orderComponents,
      });
      const order = {
        parameters: orderParameters,
        signature: signature,
      };

      // construct advanced order
      const advancedOrder = {
        parameters: orderParameters,
        numerator: wethTradeamount,
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedLockParams,
      };

      // check that bob can swap
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // neither account should have any tokens
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);

      // check lockup contract balances for each
      expect(await usdc.read.balanceOf([lockup.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([lockup.address])).to.eq(
        wethTradeamount
      );
    });

    it("TokenLockupPlansHandler swaps correctly and creates token locks (lock only offer)", async function () {
      const {
        alice,
        bob,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        lockupHandler,
        lockup,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob can fill the trade
      // alice and bob approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // alice and bob also have to approve the lockup handler for the opposite token
      // bc lockups are created atomically post-trade
      await (
        await getWeth(alice)
      ).write.approve([lockupHandler.address, wethTradeamount]);
      await (
        await getUsdc(bob)
      ).write.approve([lockupHandler.address, usdcTradeAmount]);

      // construct order
      const salt = generateSalt();
      const encodedLockParams = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              {
                name: "offerLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
              {
                name: "considerationLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
            ],
          },
        ],
        [
          {
            offerLockupParams: {
              start: timestamp + 500n,
              cliff: timestamp + 1000n,
              rate: 1000n,
              period: 1n,
            },
            // set everything to 0
            considerationLockupParams: {
              start: 0n,
              cliff: 0n,
              rate: 0n,
              period: 0n,
            },
          },
        ]
      );
      const hashedLockParams = keccak256(encodedLockParams);
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: lockupHandler.address, // don't forget this

        // this is what the trader is giving
        offer: [
          {
            itemType: 1, // 1 == erc20
            token: usdc.address,
            identifierOrCriteria: 0n, // criteria not used for erc20s
            startAmount: usdcTradeAmount,
            endAmount: usdcTradeAmount,
          },
        ],

        // what the trader expects to receive
        consideration: [
          {
            itemType: 1,
            token: weth.address,
            identifierOrCriteria: 0n,
            startAmount: wethTradeamount,
            endAmount: wethTradeamount,
            recipient: alice.account.address,
          },
        ],
        orderType: 2, // full restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: hashedLockParams,
        salt: salt,
        conduitKey: zeroHash, // not using a conduit
      };
      const orderParameters = {
        ...baseOrderParameters,
        totalOriginalConsiderationItems: 1n,
      };

      // get contract info
      const info = await seaport.read.information();
      const version = info[0];
      const name = await seaport.read.name();
      const domainData = {
        name: name,
        version: version,

        // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
        chainId: 31337,
        verifyingContract: seaportAddress,
      };
      const counter = await seaport.read.getCounter([alice.account.address]);
      const orderComponents = {
        ...baseOrderParameters,
        counter: counter,
      };

      // alice signs the order
      const signature = await alice.signTypedData({
        domain: domainData,
        types: orderType,
        primaryType: "OrderComponents",
        message: orderComponents,
      });
      const order = {
        parameters: orderParameters,
        signature: signature,
      };

      // construct advanced order
      const advancedOrder = {
        parameters: orderParameters,
        numerator: wethTradeamount,
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedLockParams,
      };

      // check that bob can swap
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // check lockup contract balances for each
      expect(await usdc.read.balanceOf([lockup.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([lockup.address])).to.eq(0n);
    });

    it("TokenLockupPlansHandler swaps correctly and creates token locks (lock only consideration)", async function () {
      const {
        alice,
        bob,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        lockupHandler,
        lockup,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob can fill the trade
      // alice and bob approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // alice and bob also have to approve the lockup handler for the opposite token
      // bc lockups are created atomically post-trade
      await (
        await getWeth(alice)
      ).write.approve([lockupHandler.address, wethTradeamount]);
      await (
        await getUsdc(bob)
      ).write.approve([lockupHandler.address, usdcTradeAmount]);

      // construct order
      const salt = generateSalt();
      const encodedLockParams = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              {
                name: "offerLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
              {
                name: "considerationLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
            ],
          },
        ],
        [
          {
            considerationLockupParams: {
              start: timestamp + 500n,
              cliff: timestamp + 1000n,
              rate: 1000n,
              period: 1n,
            },
            // set everything to 0
            offerLockupParams: {
              start: 0n,
              cliff: 0n,
              rate: 0n,
              period: 0n,
            },
          },
        ]
      );
      const hashedLockParams = keccak256(encodedLockParams);
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: lockupHandler.address, // don't forget this

        // this is what the trader is giving
        offer: [
          {
            itemType: 1, // 1 == erc20
            token: usdc.address,
            identifierOrCriteria: 0n, // criteria not used for erc20s
            startAmount: usdcTradeAmount,
            endAmount: usdcTradeAmount,
          },
        ],

        // what the trader expects to receive
        consideration: [
          {
            itemType: 1,
            token: weth.address,
            identifierOrCriteria: 0n,
            startAmount: wethTradeamount,
            endAmount: wethTradeamount,
            recipient: alice.account.address,
          },
        ],
        orderType: 2, // full restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: hashedLockParams,
        salt: salt,
        conduitKey: zeroHash, // not using a conduit
      };
      const orderParameters = {
        ...baseOrderParameters,
        totalOriginalConsiderationItems: 1n,
      };

      // get contract info
      const info = await seaport.read.information();
      const version = info[0];
      const name = await seaport.read.name();
      const domainData = {
        name: name,
        version: version,

        // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
        chainId: 31337,
        verifyingContract: seaportAddress,
      };
      const counter = await seaport.read.getCounter([alice.account.address]);
      const orderComponents = {
        ...baseOrderParameters,
        counter: counter,
      };

      // alice signs the order
      const signature = await alice.signTypedData({
        domain: domainData,
        types: orderType,
        primaryType: "OrderComponents",
        message: orderComponents,
      });
      const order = {
        parameters: orderParameters,
        signature: signature,
      };

      // construct advanced order
      const advancedOrder = {
        parameters: orderParameters,
        numerator: wethTradeamount,
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedLockParams,
      };

      // check that bob can swap
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // check lockup contract balances for each
      expect(await usdc.read.balanceOf([lockup.address])).to.eq(0n);
      expect(await weth.read.balanceOf([lockup.address])).to.eq(
        wethTradeamount
      );
    });

    /*
      Same as the first test, but now test waiting until they unlock and retrieve funds
    */
    it("TokenLockupPlansHandler swaps correctly and creates token locks, and unlock works after unlockDate", async function () {
      const {
        alice,
        bob,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        lockupHandler,
        lockup,
        getLockup,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob can fill the trade
      // alice and bob approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // alice and bob also have to approve the time lock handler for the opposite token
      // bc time locks are created atomically post-trade
      await (
        await getWeth(alice)
      ).write.approve([lockupHandler.address, wethTradeamount]);
      await (
        await getUsdc(bob)
      ).write.approve([lockupHandler.address, usdcTradeAmount]);

      // construct order
      const salt = generateSalt();
      const usdcRate = usdcTradeAmount / 1000n;
      const wethRate = wethTradeamount / 1000n;
      const cliff = 100n;
      const encodedLockParams = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              {
                name: "offerLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
              {
                name: "considerationLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
            ],
          },
        ],
        [
          {
            offerLockupParams: {
              start: timestamp,
              cliff: timestamp + cliff,
              rate: usdcRate,
              period: 1n,
            },
            considerationLockupParams: {
              start: timestamp,
              cliff: timestamp + cliff,
              rate: wethRate,
              period: 1n,
            },
          },
        ]
      );
      const hashedLockParams = keccak256(encodedLockParams);
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: lockupHandler.address, // don't forget this

        // this is what the trader is giving
        offer: [
          {
            itemType: 1, // 1 == erc20
            token: usdc.address,
            identifierOrCriteria: 0n, // criteria not used for erc20s
            startAmount: usdcTradeAmount,
            endAmount: usdcTradeAmount,
          },
        ],

        // what the trader expects to receive
        consideration: [
          {
            itemType: 1,
            token: weth.address,
            identifierOrCriteria: 0n,
            startAmount: wethTradeamount,
            endAmount: wethTradeamount,
            recipient: alice.account.address,
          },
        ],
        orderType: 2, // full restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: hashedLockParams,
        salt: salt,
        conduitKey: zeroHash, // not using a conduit
      };
      const orderParameters = {
        ...baseOrderParameters,
        totalOriginalConsiderationItems: 1n,
      };

      // get contract info
      const info = await seaport.read.information();
      const version = info[0];
      const name = await seaport.read.name();
      const domainData = {
        name: name,
        version: version,

        // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
        chainId: 31337,
        verifyingContract: seaportAddress,
      };
      const counter = await seaport.read.getCounter([alice.account.address]);
      const orderComponents = {
        ...baseOrderParameters,
        counter: counter,
      };

      // alice signs the order
      const signature = await alice.signTypedData({
        domain: domainData,
        types: orderType,
        primaryType: "OrderComponents",
        message: orderComponents,
      });
      const order = {
        parameters: orderParameters,
        signature: signature,
      };

      // construct advanced order
      const advancedOrder = {
        parameters: orderParameters,
        numerator: wethTradeamount,
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedLockParams,
      };

      // check that bob can swap
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // neither account should have any tokens
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);

      // check time lock contract balances for each
      expect(await usdc.read.balanceOf([lockup.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([lockup.address])).to.eq(
        wethTradeamount
      );

      // go forward in time so we're just before the cliff
      await time.increase(80);

      // each user retrieves their positions
      await (await getLockup(alice)).write.redeemAllPlans();
      await (await getLockup(bob)).write.redeemAllPlans();

      // balances should still be 0
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // go forward in time so we just reached the cliff
      await time.increase(20);

      // each user retrieves their positions
      await (await getLockup(alice)).write.redeemAllPlans();
      await (await getLockup(bob)).write.redeemAllPlans();

      // balances should roughly be rate * cliff
      expect(
        Number(await weth.read.balanceOf([alice.account.address]))
      ).to.greaterThan(Number(wethRate * cliff));
      expect(
        Number(await usdc.read.balanceOf([bob.account.address]))
      ).to.greaterThan(Number(usdcRate * cliff));
      expect(
        Number(await weth.read.balanceOf([alice.account.address]))
      ).to.lessThan(Number(wethTradeamount));
      expect(
        Number(await usdc.read.balanceOf([bob.account.address]))
      ).to.lessThan(Number(usdcTradeAmount));

      // go forward in time so the full amount is vested
      await time.increase(1000);

      // each user retrieves their positions
      await (await getLockup(alice)).write.redeemAllPlans();
      await (await getLockup(bob)).write.redeemAllPlans();

      // check all balances
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        wethTradeamount
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);
    });

    it("try to lock order with no offer and/or consideration", async function () {
      const { bob, weth, getWeth, startingWethBalance, lockupHandler } =
        await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const wethTradeamount = parseUnits("1", 18);

      // imagine that bob was trading with alice and had approved the time lock handler to spend his weth
      await (
        await getWeth(bob)
      ).write.approve([lockupHandler.address, wethTradeamount]);

      // check for expected starting balance
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );

      // just test by calling zone directly, because seaport will reject order with no offer/consideration
      // no consideration
      const encodedLockParamsNoConsideration = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              {
                name: "considerationLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
            ],
          },
        ],
        [
          {
            considerationLockupParams: {
              start: timestamp + 500n,
              cliff: timestamp + 1000n,
              rate: 1000n,
              period: 1n,
            },
          },
        ]
      );
      const hashedLockParamsNoConsideration = keccak256(
        encodedLockParamsNoConsideration
      );
      const zoneParamsNoConsideration = {
        orderHash: zeroHash,
        fulfiller: bob.account.address,
        offerer: zeroAddress,
        offer: [
          {
            itemType: 1, // erc20
            token: weth.address,
            identifier: 0n,
            amount: wethTradeamount,
          },
        ],
        consideration: [],
        extraData: encodedLockParamsNoConsideration,
        orderHashes: [],
        startTime: 0n,
        endTime: 0n,
        zoneHash: hashedLockParamsNoConsideration,
      };
      expect(
        lockupHandler.write.validateOrder([zoneParamsNoConsideration])
      ).to.be.rejectedWith("NO_CONSIDERATION");

      // no offer
      const encodedLockParamsNoOffer = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              {
                name: "offerLockupParams",
                type: "tuple",
                components: [
                  { name: "start", type: "uint256" },
                  { name: "cliff", type: "uint256" },
                  { name: "rate", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
            ],
          },
        ],
        [
          {
            offerLockupParams: {
              start: timestamp + 500n,
              cliff: timestamp + 1000n,
              rate: 1000n,
              period: 1n,
            },
          },
        ]
      );
      const hashedLockParamsNoOffer = keccak256(encodedLockParamsNoOffer);
      const zoneParamsNoOffer = {
        orderHash: zeroHash,
        fulfiller: bob.account.address,
        offerer: zeroAddress,
        offer: [
          {
            itemType: 1, // erc20
            token: weth.address,
            identifier: 0n,
            amount: wethTradeamount,
          },
        ],
        consideration: [],
        extraData: encodedLockParamsNoOffer,
        orderHashes: [],
        startTime: 0n,
        endTime: 0n,
        zoneHash: hashedLockParamsNoOffer,
      };
      expect(
        lockupHandler.write.validateOrder([zoneParamsNoOffer])
      ).to.be.rejectedWith("NO_OFFER");
    });

    it("only seaport allowed to call validateOrder", async function () {
      const { bob, lockupHandler } = await loadFixture(fixture);

      // fake zone params for testing, these don't matter
      const fakeZoneParams = {
        orderHash: zeroHash,
        fulfiller: bob.account.address,
        offerer: zeroAddress,
        offer: [],
        consideration: [],
        extraData: zeroHash,
        orderHashes: [],
        startTime: 0n,
        endTime: 0n,
        zoneHash: zeroHash,
      };

      // try calling validateOrder directly
      expect(
        lockupHandler.write.validateOrder([fakeZoneParams])
      ).to.be.rejectedWith("CALLER_NOT_SEAPORT");
    });
  });
});
