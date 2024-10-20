import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits, encodeFunctionData, hashTypedData } from "viem";
import orderType from "./utils/orderType";
import { seaportAddress, zeroAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";
import safeFixture from "./fixtures/safeFixture";
import {
  buildSafeTransaction,
  executeTx,
  SafeSignature,
  safeSignTypedData,
  signMessageAndValidate,
} from "./utils/safeHelpers";
import { ethers } from "ethers";

describe("Seaport ERC20 tests", function () {
  async function fixture() {
    return {
      ...(await seaportFixture()),
      ...(await accountsFixture()),
      ...(await safeFixture()),
    };
  }

  describe("erc20<->erc20", function () {
    /*
      Test a completely 'public' trade, anyone can fill it if they have the signed order
      - in this case, test only a complete fill
    */
    it("any recipient, complete fill", async function () {
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
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice and bob approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: zeroAddress,

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
        orderType: 0, // full open
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: zeroHash, // not using zones
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
      const order = {
        parameters: orderParameters,
        signature: signature,
      };
      await (await getSeaport(bob)).write.fulfillOrder([order, zeroHash]);

      // check that the swap was correct
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
      Restrict the trade to a specific taker, and they fill the order completely
    */
    it("one recipient, complete fill", async function () {
      const {
        alice,
        bob,
        charlie,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
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

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: bob.account.address,

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
        zoneHash: zeroHash, // not using zones
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

      // although alice intends for bob to fill the order,
      // let's pretend that charlie somehow intercepts alice's signed message
      // charlie should still not be able to fill the order
      await (
        await getWeth(charlie)
      ).write.approve([seaportAddress, wethTradeamount]);
      await expect(
        (await getSeaport(charlie)).write.fulfillOrder([order, zeroHash])
      ).to.be.rejectedWith(
        "VM Exception while processing transaction: reverted with an unrecognized custom error"
      );

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
      await (await getSeaport(bob)).write.fulfillOrder([order, zeroHash]);

      // check that the swap was correct
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
      Test paying fees to a third party (e.g. aqueduct otc)
      - fulfiller fees can easily be paid by adding a second consideration item
    */
    it("considerationItem fees", async function () {
      const {
        alice,
        bob,
        frank,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethFeeAmount = parseUnits("1", 17);
      const wethTotalTradeamount = parseUnits("1", 18);
      const wethTradeAmount = wethTotalTradeamount - wethFeeAmount;

      // alice and bob approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTotalTradeamount]);

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: zeroAddress,

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
            startAmount: wethTradeAmount,
            endAmount: wethTradeAmount,
            recipient: alice.account.address,
          },

          // add the fee as a consideration:
          {
            itemType: 1,
            token: weth.address,
            identifierOrCriteria: 0n,
            startAmount: wethFeeAmount,
            endAmount: wethFeeAmount,
            recipient: frank.account.address, // frank will be the third party
          },
        ],
        orderType: 0, // full open
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: zeroHash, // not using zones
        salt: salt,
        conduitKey: zeroHash, // not using a conduit
      };
      const orderParameters = {
        ...baseOrderParameters,
        totalOriginalConsiderationItems: 2n,
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

      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // frank (3rd party) shouldn't have any funds
      expect(await usdc.read.balanceOf([frank.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([frank.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      const order = {
        parameters: orderParameters,
        signature: signature,
      };
      await (await getSeaport(bob)).write.fulfillOrder([order, zeroHash]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        wethTradeAmount
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);

      // check that frank got the fee
      expect(await weth.read.balanceOf([frank.account.address])).to.eq(
        wethFeeAmount
      );
    });

    /*
      Test paying fees to a third party (e.g. aqueduct otc)
      - seaport only supports a 'recipient' field for consideration items
      - we can work around this by adding the fee in the consideration items
      - with this, the token gets sent to the fulfiller, but then immediately to the third party recipient
      - the only caveat is the fulfiller will need to approve seaport from the fee token
    */
    it("offerItem fees", async function () {
      const {
        alice,
        bob,
        frank,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const usdcFeeAmount = parseUnits("2", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice and bob approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // bob approves seaport from the fee token
      await (
        await getUsdc(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: zeroAddress,

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

          // add the fee as a consideration:
          {
            itemType: 1,
            token: usdc.address,
            identifierOrCriteria: 0n,
            startAmount: usdcFeeAmount,
            endAmount: usdcFeeAmount,
            recipient: frank.account.address, // frank will be the third party
          },
        ],
        orderType: 0, // full open
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: zeroHash, // not using zones
        salt: salt,
        conduitKey: zeroHash, // not using a conduit
      };
      const orderParameters = {
        ...baseOrderParameters,
        totalOriginalConsiderationItems: 2n,
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

      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // frank (3rd party) shouldn't have any funds
      expect(await usdc.read.balanceOf([frank.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([frank.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      const order = {
        parameters: orderParameters,
        signature: signature,
      };
      await (await getSeaport(bob)).write.fulfillOrder([order, zeroHash]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        wethTradeamount
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        usdcTradeAmount - usdcFeeAmount
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);

      // check that frank got the fee
      expect(await usdc.read.balanceOf([frank.account.address])).to.eq(
        usdcFeeAmount
      );
    });

    /*
      - e.g. Alice offers token A for token B,
      - Frank acts as a dealer, showing the order to Bob,
      - Bob creates a new order to pay a fee to Frank, and matches the orders
      - note that Frank does not need prior funds
    */
    it("multi-hop trade", async function () {
      const {
        alice,
        bob,
        frank,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice, bob, and frank approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getUsdc(frank)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(frank)
      ).write.approve([seaportAddress, wethTradeamount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // construct Alice's order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: zeroAddress,

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
        orderType: 0, // full open
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: zeroHash, // not using zones
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

      // construct Bob's order
      const salt2 = generateSalt();
      const baseOrderParameters2 = {
        offerer: bob.account.address,
        zone: zeroAddress,

        // this is what the trader is giving
        offer: [
          {
            itemType: 1,
            token: weth.address,
            identifierOrCriteria: 0n,
            startAmount: wethTradeamount,
            endAmount: wethTradeamount,
          },
        ],

        // what the trader expects to receive
        consideration: [
          {
            itemType: 1,
            token: usdc.address,
            identifierOrCriteria: 0n,
            startAmount: (usdcTradeAmount * 9n) / 10n,
            endAmount: (usdcTradeAmount * 9n) / 10n,
            recipient: bob.account.address,
          },
          {
            itemType: 1,
            token: usdc.address,
            identifierOrCriteria: 0n,
            startAmount: usdcTradeAmount / 10n,
            endAmount: usdcTradeAmount / 10n,
            recipient: frank.account.address,
          },
        ],
        orderType: 0, // full open
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now
        zoneHash: zeroHash, // not using zones
        salt: salt2,
        conduitKey: zeroHash, // not using a conduit
      };
      const orderParameters2 = {
        ...baseOrderParameters2,
        totalOriginalConsiderationItems: 1n,
      };

      const counter2 = await seaport.read.getCounter([bob.account.address]);
      const orderComponents2 = {
        ...baseOrderParameters2,
        counter: counter2,
      };

      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([frank.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([frank.account.address])).to.eq(0n);

      // bob settles all orders at once
      const order = {
        parameters: orderParameters,
        signature: signature,
      };
      const order2 = {
        parameters: orderParameters2,
        signature: "0x" as `0x${string}`, // NOTE: bob doesn't need to sign this because he's signing the tx
      };
      const orders = [order, order2];
      const fulfillments = [
        {
          offerComponents: [{ orderIndex: 0n, itemIndex: 0n }],
          considerationComponents: [{ orderIndex: 1n, itemIndex: 0n }],
        },
        {
          offerComponents: [{ orderIndex: 0n, itemIndex: 0n }],
          considerationComponents: [{ orderIndex: 1n, itemIndex: 1n }],
        },
        {
          offerComponents: [{ orderIndex: 1n, itemIndex: 0n }],
          considerationComponents: [{ orderIndex: 0n, itemIndex: 0n }],
        },
      ];
      await (await getSeaport(bob)).write.matchOrders([orders, fulfillments]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        wethTradeamount
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        (usdcTradeAmount * 9n) / 10n
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);

      // check that Frank got his fee
      expect(await usdc.read.balanceOf([frank.account.address])).to.eq(
        usdcTradeAmount / 10n
      );
    });

    /*
      - basic order like first test
      - except we use erc1271 signer
      - NOTE: using safe for testing
    */
    it("erc1271 signer <-> EOA", async function () {
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
        aliceSafe,
      } = await loadFixture(fixture);

      // alice sends all her usdc to her safe
      await (
        await getUsdc(alice)
      ).write.transfer([aliceSafe.address, aliceStartingUsdcBalance]);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // aliceSafe approves seaport contract
      const approveCalldata = encodeFunctionData({
        abi: usdc.abi,
        functionName: "approve",
        args: [seaportAddress, usdcTradeAmount],
      });
      const approveTx = buildSafeTransaction({
        to: usdc.address,
        data: approveCalldata,
        safeTxGas: 1000000n,
        nonce: await aliceSafe.read.nonce(),
      });
      const threshold = 1n;
      const sigs: SafeSignature[] = await Promise.all(
        [alice].slice(0, Number(threshold)).map(async (signer) => {
          return await safeSignTypedData(signer, aliceSafe.address, approveTx);
        })
      );
      await executeTx(aliceSafe, approveTx, sigs);

      // check aliceSafe's approval
      expect(
        await usdc.read.allowance([aliceSafe.address, seaportAddress])
      ).to.eq(usdcTradeAmount);

      // bob approves seaport contract
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: aliceSafe.address,
        zone: zeroAddress,
        offer: [
          {
            itemType: 1,
            token: usdc.address,
            identifierOrCriteria: 0n,
            startAmount: usdcTradeAmount,
            endAmount: usdcTradeAmount,
          },
        ],
        consideration: [
          {
            itemType: 1,
            token: weth.address,
            identifierOrCriteria: 0n,
            startAmount: wethTradeamount,
            endAmount: wethTradeamount,
            recipient: aliceSafe.address,
          },
        ],
        orderType: 0,
        startTime: timestamp,
        endTime: timestamp + 86400n,
        zoneHash: zeroHash,
        salt: salt,
        conduitKey: zeroHash,
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

      // aliceSafe signs the order
      const dataHash = hashTypedData({
        domain: domainData,
        types: orderType,
        primaryType: "OrderComponents",
        message: orderComponents,
      });
      const signature = await signMessageAndValidate(
        [alice],
        dataHash,
        aliceSafe.address
      );

      // check for expected starting balances
      expect(await usdc.read.balanceOf([aliceSafe.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([aliceSafe.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      const order = {
        parameters: orderParameters,
        signature: signature,
      };
      await (await getSeaport(bob)).write.fulfillOrder([order, zeroHash]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([aliceSafe.address])).to.eq(
        wethTradeamount
      );
      expect(await usdc.read.balanceOf([aliceSafe.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        usdcTradeAmount
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);
    });
  });
});
