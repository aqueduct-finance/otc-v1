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
import timeLockFixture from "./fixtures/timeLockFixture";

describe("TimeLockHandler tests", function () {
  async function fixture() {
    const sf = await seaportFixture();
    const af = await accountsFixture();
    const tL = await timeLockFixture();

    const timeLockHandler = await hre.viem.deployContract("TimeLockHandler", [
      tL.timeLock.address,
      sf.seaport.address,
    ]);

    return {
      ...sf,
      ...af,
      ...tL,
      timeLockHandler,
    };
  }

  describe("erc20<->erc20", function () {
    /*
      Test a swap with the TimeLockHandler
      This will swap the tokens, and atomically deposit them into time lock nfts
    */
    it("TimeLockHandler swaps correctly and creates token locks", async function () {
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
        timeLockHandler,
        timeLock,
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
      ).write.approve([timeLockHandler.address, wethTradeamount]);
      await (
        await getUsdc(bob)
      ).write.approve([timeLockHandler.address, usdcTradeAmount]);

      // construct order
      const salt = generateSalt();
      const encodedLockParams = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              { name: "offerUnlockDate", type: "uint256" },
              { name: "considerationUnlockDate", type: "uint256" },
            ],
          },
        ],
        [
          {
            offerUnlockDate: timestamp + 500n,
            considerationUnlockDate: timestamp + 250n,
          },
        ]
      );
      const hashedLockParams = keccak256(encodedLockParams);
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: timeLockHandler.address, // don't forget this

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
      expect(await usdc.read.balanceOf([timeLock.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([timeLock.address])).to.eq(
        wethTradeamount
      );
    });

    /*
      Same as the first test, but now test waiting until they unlock and retrieve funds
    */
    it("TimeLockHandler swaps correctly and creates token locks, and unlock works after unlockDate", async function () {
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
        timeLockHandler,
        timeLock,
        getTimeLock,
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
      ).write.approve([timeLockHandler.address, wethTradeamount]);
      await (
        await getUsdc(bob)
      ).write.approve([timeLockHandler.address, usdcTradeAmount]);

      // construct order
      const salt = generateSalt();
      const encodedLockParams = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              { name: "offerUnlockDate", type: "uint256" },
              { name: "considerationUnlockDate", type: "uint256" },
            ],
          },
        ],
        [
          {
            offerUnlockDate: timestamp + 500n,
            considerationUnlockDate: timestamp + 250n,
          },
        ]
      );
      const hashedLockParams = keccak256(encodedLockParams);
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: timeLockHandler.address, // don't forget this

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
      expect(await usdc.read.balanceOf([timeLock.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([timeLock.address])).to.eq(
        wethTradeamount
      );

      // go forward in time so that both positions unlock
      await time.increase(600);

      // get nft ids
      const aliceNftId = await timeLock.read.tokenOfOwnerByIndex([
        alice.account.address,
        0n,
      ]);
      const bobNftId = await timeLock.read.tokenOfOwnerByIndex([
        bob.account.address,
        0n,
      ]);

      // each user retrieves their positions
      await (await getTimeLock(alice)).write.redeemNFT([aliceNftId]);
      await (await getTimeLock(bob)).write.redeemNFT([bobNftId]);

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

    /*
      Try to unlock nfts early
    */
    it("TimeLockHandler swaps correctly and creates token locks, try to unlock early", async function () {
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
        timeLockHandler,
        timeLock,
        getTimeLock,
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
      ).write.approve([timeLockHandler.address, wethTradeamount]);
      await (
        await getUsdc(bob)
      ).write.approve([timeLockHandler.address, usdcTradeAmount]);

      // construct order
      const salt = generateSalt();
      const encodedLockParams = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              { name: "offerUnlockDate", type: "uint256" },
              { name: "considerationUnlockDate", type: "uint256" },
            ],
          },
        ],
        [
          {
            offerUnlockDate: timestamp + 500n,
            considerationUnlockDate: timestamp + 250n,
          },
        ]
      );
      const hashedLockParams = keccak256(encodedLockParams);
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: timeLockHandler.address, // don't forget this

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
      expect(await usdc.read.balanceOf([timeLock.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([timeLock.address])).to.eq(
        wethTradeamount
      );

      // get nft ids
      const aliceNftId = await timeLock.read.tokenOfOwnerByIndex([
        alice.account.address,
        0n,
      ]);
      const bobNftId = await timeLock.read.tokenOfOwnerByIndex([
        bob.account.address,
        0n,
      ]);

      // both should fail if trying to unlock immediately
      expect(
        (await getTimeLock(alice)).write.redeemNFT([aliceNftId])
      ).to.be.rejectedWith("NFT04");
      expect(
        (await getTimeLock(bob)).write.redeemNFT([bobNftId])
      ).to.be.rejectedWith("NFT04");

      // consideration unlocks first after 250 seconds
      await time.increase(300);
      expect((await getTimeLock(alice)).write.redeemNFT([aliceNftId])).to.not.be
        .rejected;
      // but offer shouldn't be unlocked yet
      expect(
        (await getTimeLock(bob)).write.redeemNFT([bobNftId])
      ).to.be.rejectedWith("NFT04");

      // now offer should unlock
      await time.increase(300);
      expect(
        (await getTimeLock(bob)).write.redeemNFT([bobNftId])
      ).to.be.rejectedWith("NFT04");
    });

    it("try to lock order with no offer and/or consideration", async function () {
      const {
        alice,
        bob,
        weth,
        getWeth,
        startingWethBalance,
        timeLockHandler,
        timeLock,
        getTimeLock,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const wethTradeamount = parseUnits("1", 18);

      // imagine that bob was trading with alice and had approved the time lock handler to spend his weth
      await (
        await getWeth(bob)
      ).write.approve([timeLockHandler.address, wethTradeamount]);

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
              { name: "offerUnlockDate", type: "uint256" },
              { name: "considerationUnlockDate", type: "uint256" },
            ],
          },
        ],
        [
          {
            offerUnlockDate: timestamp,
            considerationUnlockDate: 0n,
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
        timeLockHandler.write.validateOrder([zoneParamsNoConsideration])
      ).to.be.rejectedWith("NO_CONSIDERATION");

      // no offer
      const encodedLockParamsNoOffer = encodeAbiParameters(
        [
          {
            name: "LockParams",
            type: "tuple",
            components: [
              { name: "offerUnlockDate", type: "uint256" },
              { name: "considerationUnlockDate", type: "uint256" },
            ],
          },
        ],
        [
          {
            offerUnlockDate: timestamp,
            considerationUnlockDate: 0n,
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
        timeLockHandler.write.validateOrder([zoneParamsNoOffer])
      ).to.be.rejectedWith("NO_OFFER");
    });

    it("only seaport allowed to call validateOrder", async function () {
      const {
        alice,
        bob,
        weth,
        getWeth,
        startingWethBalance,
        timeLockHandler,
        timeLock,
        getTimeLock,
      } = await loadFixture(fixture);

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
        timeLockHandler.write.validateOrder([fakeZoneParams])
      ).to.be.rejectedWith("CALLER_NOT_SEAPORT");
    });
  });
});
