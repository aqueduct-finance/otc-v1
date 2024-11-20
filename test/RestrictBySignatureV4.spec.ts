import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits, encodeAbiParameters } from "viem";
import hre from "hardhat";
import orderType from "./utils/orderType";
import { seaportAddress, zeroAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";
import safeFixture from "./fixtures/safeFixture";
import serverSignatureTypeV4 from "./utils/serverSignatureTypeV4";

describe("RestrictBySignatureV4 Zone tests", function () {
  async function fixture() {
    const sf = await seaportFixture();
    const af = await accountsFixture();
    const saf = await safeFixture();

    // set erin as the server owner
    const server = af.erin;
    const restrictToAddressesZone = await hre.viem.deployContract(
      "RestrictBySignatureV4",
      [server.account.address, 31337n, sf.seaport.address, sf.seaport.address]
    );

    return {
      ...sf,
      ...af,
      ...saf,
      restrictToAddressesZone,
      server,
    };
  }

  describe("erc20<->erc20", function () {
    it("only seaport allowed to call validateOrder", async function () {
      const { bob, restrictToAddressesZone } = await loadFixture(fixture);

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
      await expect(
        restrictToAddressesZone.write.validateOrder([fakeZoneParams])
      ).to.be.rejectedWith("CALLER_NOT_SEAPORT");
    });

    /*
        Restrict the trade to a specific set of takers
        - only allow complete fills
        - we expect that after one taker fills the order, others can't do the same after
    */
    it("multiple recipients, complete fill by first", async function () {
      const {
        alice,
        bob,
        charlie,
        dan,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        restrictToAddressesZone,
        server,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob and charlie can fill the trade
      // alice, bob, and charlie approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);
      await (
        await getWeth(charlie)
      ).write.approve([seaportAddress, wethTradeamount]);

      // fill caps
      const bobFillCap = usdcTradeAmount;
      const charlieFillCap = usdcTradeAmount;
      const minFillCap = 0n;

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: restrictToAddressesZone.address,

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

        zoneHash: zeroHash,

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

      // get order params
      const sigDomainData = {
        name: await restrictToAddressesZone.read._NAME(),
        version: await restrictToAddressesZone.read._VERSION(),
        chainId: 31337,
        verifyingContract: restrictToAddressesZone.address,
      };
      const orderHash = await seaport.read.getOrderHash([orderComponents]);
      const startTime = 0n;
      const endTime = timestamp + 86400n;

      // alice gets server token
      // server is signing off on the restriction set
      const deadline = timestamp + 600n;
      const authParams = {
        orderHash: orderHash,
        fulfiller: bob.account.address,
        minFill: minFillCap,
        maxFill: bobFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams,
      });
      const serverToken = {
        deadline: deadline,
        signature: serverSignature,
      };

      // get extra data
      const encodedExtraData = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: bobFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken,
          },
        ]
      );

      // construct advanced order
      const advancedOrder = {
        parameters: orderParameters,
        numerator: wethTradeamount,
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };

      // although alice intends for bob or charlie to fill the order,
      // let's pretend that dan somehow intercepts alice's signed message and the merkle tree
      // dan should still not be able to fill the order
      await (
        await getWeth(dan)
      ).write.approve([seaportAddress, wethTradeamount]);
      await expect(
        (
          await getSeaport(dan)
        ).write.fulfillAdvancedOrder([
          advancedOrder,
          [],
          zeroHash,
          dan.account.address,
        ])
      ).to.be.rejectedWith("ORDER_RESTRICTED");

      // bob will take the swap
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

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
        - Just restrict to one user
        - try to fill before startTimestamp
        - fill some after it
        - try to fill more after endTimestamp
    */
    it("one recipient, under, within, and over timeframe", async function () {
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
        restrictToAddressesZone,
        server,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob and charlie can fill the trade
      // alice, bob, and charlie approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);

      // fill caps
      const bobFillCap = usdcTradeAmount;
      const minFillCap = 0n;

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: restrictToAddressesZone.address,

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
        orderType: 3, // partial restricted

        // NOTE: don't use these
        startTime: 0n,
        endTime: timestamp + 1000000000000n,

        zoneHash: zeroHash,

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

      // get order data
      const sigDomainData = {
        name: await restrictToAddressesZone.read._NAME(),
        version: await restrictToAddressesZone.read._VERSION(),
        chainId: 31337,
        verifyingContract: restrictToAddressesZone.address,
      };
      const orderHash = await seaport.read.getOrderHash([orderComponents]);
      const buffer = 500n;
      const startTime = timestamp + buffer;
      const endTime = startTime + buffer;

      // alice gets server token
      // server is signing off on the restriction set
      const deadline = timestamp + 1000000000n;
      const authParams = {
        orderHash: orderHash,
        fulfiller: bob.account.address,
        minFill: minFillCap,
        maxFill: bobFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams,
      });
      const serverToken = {
        deadline: deadline,
        signature: serverSignature,
      };

      // get extra data
      const encodedExtraData = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: bobFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken,
          },
        ]
      );

      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // partial fill 20%
      const advancedOrder = {
        parameters: orderParameters,
        numerator: wethTradeamount / 5n, // 20%
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };

      // bob tries to fill before start time
      await expect(
        (
          await getSeaport(bob)
        ).write.fulfillAdvancedOrder([
          advancedOrder,
          [],
          zeroHash,
          bob.account.address,
        ])
      ).to.be.rejectedWith("BEFORE_START_TIME");

      // go forward past start time
      await time.increase(buffer + 10n);

      // bob is able to fill some after start time (and before end time)
      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        (wethTradeamount * 2n) / 10n
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        (usdcTradeAmount * 8n) / 10n
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        (usdcTradeAmount * 2n) / 10n
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        (wethTradeamount * 8n) / 10n
      );

      // go forward past end time
      await time.increase(buffer + 10n);

      // bob tries to fill after end time
      await expect(
        (
          await getSeaport(bob)
        ).write.fulfillAdvancedOrder([
          advancedOrder,
          [],
          zeroHash,
          bob.account.address,
        ])
      ).to.be.rejectedWith("END_TIME_EXCEEDED");
    });

    /*
        Restrict the trade to a specific set of takers
        - allow partial fills
    */
    it("multiple recipients, partial fills", async function () {
      const {
        alice,
        bob,
        charlie,
        dan,
        erin,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        restrictToAddressesZone,
        server,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeAmount = parseUnits("1", 18);

      // alice will designate that bob, charlie, and dan can fill the trade
      // alice, bob, charlie, and dan approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeAmount]);
      await (
        await getWeth(charlie)
      ).write.approve([seaportAddress, wethTradeAmount]);
      await (
        await getWeth(dan)
      ).write.approve([seaportAddress, wethTradeAmount]);

      // fill caps
      const bobFillCap = usdcTradeAmount;
      const charlieFillCap = usdcTradeAmount;
      const danFillCap = usdcTradeAmount;
      const minFillCap = 0n;

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: restrictToAddressesZone.address,

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
        ],
        orderType: 3, // partial restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now

        zoneHash: zeroHash,

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

      // get order data
      const sigDomainData = {
        name: await restrictToAddressesZone.read._NAME(),
        version: await restrictToAddressesZone.read._VERSION(),
        chainId: 31337,
        verifyingContract: restrictToAddressesZone.address,
      };
      const orderHash = await seaport.read.getOrderHash([orderComponents]);
      const startTime = 0n;
      const endTime = timestamp + 86400n;

      // bob gets server token
      // server is signing off on the restriction set
      const deadline = timestamp + 600n;
      const authParams = {
        orderHash: orderHash,
        fulfiller: bob.account.address,
        minFill: minFillCap,
        maxFill: bobFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams,
      });
      const serverToken = {
        deadline: deadline,
        signature: serverSignature,
      };

      // get extra data
      const encodedExtraData = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: bobFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken,
          },
        ]
      );
      const advancedOrder = {
        parameters: orderParameters,
        numerator: wethTradeAmount / 2n,
        denominator: wethTradeAmount,
        signature: signature,
        extraData: encodedExtraData,
      };

      // bob and charlie will each take half the swap

      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills half of it
      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        wethTradeAmount / 2n
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        usdcTradeAmount / 2n
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        usdcTradeAmount / 2n
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        wethTradeAmount / 2n
      );

      // check charlie's expected starting balances
      expect(await usdc.read.balanceOf([charlie.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([charlie.account.address])).to.eq(
        startingWethBalance
      );

      // charlie gets server token
      // server is signing off on the restriction set
      const authParams2 = {
        orderHash: orderHash,
        fulfiller: charlie.account.address,
        minFill: minFillCap,
        maxFill: charlieFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature2 = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams2,
      });
      const serverToken2 = {
        deadline: deadline,
        signature: serverSignature2,
      };

      // get extra data
      const encodedExtraData2 = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: charlieFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken2,
          },
        ]
      );
      const advancedOrder2 = {
        parameters: orderParameters,
        numerator: wethTradeAmount / 2n,
        denominator: wethTradeAmount,
        signature: signature,
        extraData: encodedExtraData2,
      };

      // charlie fills the rest of the order
      await (
        await getSeaport(charlie)
      ).write.fulfillAdvancedOrder([
        advancedOrder2,
        [],
        zeroHash,
        charlie.account.address,
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        wethTradeAmount
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([charlie.account.address])).to.eq(
        usdcTradeAmount / 2n
      );
      expect(await weth.read.balanceOf([charlie.account.address])).to.eq(
        wethTradeAmount / 2n
      );

      // dan gets server token
      // server is signing off on the restriction set
      const authParams3 = {
        orderHash: orderHash,
        fulfiller: dan.account.address,
        minFill: minFillCap,
        maxFill: danFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature3 = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams3,
      });
      const serverToken3 = {
        deadline: deadline,
        signature: serverSignature3,
      };

      // get extra data
      const encodedExtraData3 = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: danFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken3,
          },
        ]
      );
      const advancedOrder3 = {
        parameters: orderParameters,
        numerator: wethTradeAmount,
        denominator: wethTradeAmount,
        signature: signature,
        extraData: encodedExtraData3,
      };

      // now that the order is completely filled, dan's fulfillment should fail
      await expect(
        (
          await getSeaport(dan)
        ).write.fulfillAdvancedOrder([
          advancedOrder3,
          [],
          zeroHash,
          dan.account.address,
        ])
      ).to.be.rejectedWith(
        "VM Exception while processing transaction: reverted with an unrecognized custom error"
      );
    });

    /*
        Enforce fill caps:
        - bob: 40%
        - charlie: 60%
    */
    it("multiple recipients, partial fills, 40/60 fill caps", async function () {
      const {
        alice,
        bob,
        charlie,
        dan,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        restrictToAddressesZone,
        server,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob and charlie can fill the trade
      // alice, bob, and charlie approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);
      await (
        await getWeth(charlie)
      ).write.approve([seaportAddress, wethTradeamount]);

      // fill caps
      const bobFillCap = (usdcTradeAmount * 4n) / 10n;
      const charlieFillCap = (usdcTradeAmount * 6n) / 10n;
      const minFillCap = 0n;

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: restrictToAddressesZone.address,

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
        orderType: 3, // partial restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now

        zoneHash: zeroHash,

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

      // get order data
      const sigDomainData = {
        name: await restrictToAddressesZone.read._NAME(),
        version: await restrictToAddressesZone.read._VERSION(),
        chainId: 31337,
        verifyingContract: restrictToAddressesZone.address,
      };
      const orderHash = await seaport.read.getOrderHash([orderComponents]);
      const startTime = 0n;
      const endTime = timestamp + 86400n;

      // bob gets server token
      // server is signing off on the restriction set
      const deadline = timestamp + 600n;
      const authParams = {
        orderHash: orderHash,
        fulfiller: bob.account.address,
        minFill: minFillCap,
        maxFill: bobFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams,
      });
      const serverToken = {
        deadline: deadline,
        signature: serverSignature,
      };

      // get extra data
      const encodedExtraData = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: bobFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken,
          },
        ]
      );

      // bob tries to fill more than 40%
      const badOrder = {
        parameters: orderParameters,
        numerator: (wethTradeamount * 5n) / 10n, // fill 50%
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };
      await expect(
        (
          await getSeaport(bob)
        ).write.fulfillAdvancedOrder([
          badOrder,
          [],
          zeroHash,
          bob.account.address,
        ])
      ).to.be.rejectedWith("MAX_FILL_EXCEEDED");

      // construct advanced order
      const advancedOrder = {
        parameters: orderParameters,
        numerator: (wethTradeamount * 4n) / 10n, // fill 40%
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };

      // bob fills the first 40%
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        (wethTradeamount * 4n) / 10n
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        (usdcTradeAmount * 6n) / 10n
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        (usdcTradeAmount * 4n) / 10n
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        (wethTradeamount * 6n) / 10n
      );

      // charlie gets server token
      // server is signing off on the restriction set
      const authParams2 = {
        orderHash: orderHash,
        fulfiller: charlie.account.address,
        minFill: minFillCap,
        maxFill: charlieFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature2 = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams2,
      });
      const serverToken2 = {
        deadline: deadline,
        signature: serverSignature2,
      };

      // get extra data
      const encodedExtraData2 = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: charlieFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken2,
          },
        ]
      );
      const advancedOrder2 = {
        parameters: orderParameters,
        numerator: wethTradeamount, // fill the rest
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData2,
      };
      await (
        await getSeaport(charlie)
      ).write.fulfillAdvancedOrder([
        advancedOrder2,
        [],
        zeroHash,
        charlie.account.address,
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        wethTradeamount
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([charlie.account.address])).to.eq(
        (usdcTradeAmount * 6n) / 10n
      );
      expect(await weth.read.balanceOf([charlie.account.address])).to.eq(
        (wethTradeamount * 4n) / 10n
      );
    });

    /*
        User fills multiple times, check that zone stores prior fill amounts correctly
    */
    it("multiple partial fills, goes over fill cap", async function () {
      const {
        alice,
        bob,
        charlie,
        dan,
        seaport,
        usdc,
        weth,
        getSeaport,
        getUsdc,
        getWeth,
        aliceStartingUsdcBalance,
        startingWethBalance,
        restrictToAddressesZone,
        server,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob and charlie can fill the trade
      // alice, bob, and charlie approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);
      await (
        await getWeth(charlie)
      ).write.approve([seaportAddress, wethTradeamount]);

      // fill caps
      const bobFillCap = (usdcTradeAmount * 4n) / 10n;
      const charlieFillCap = (usdcTradeAmount * 6n) / 10n;
      const minFillCap = 0n;

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: restrictToAddressesZone.address,

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
        orderType: 3, // partial restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now

        zoneHash: zeroHash,

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

      // get order data
      const sigDomainData = {
        name: await restrictToAddressesZone.read._NAME(),
        version: await restrictToAddressesZone.read._VERSION(),
        chainId: 31337,
        verifyingContract: restrictToAddressesZone.address,
      };
      const orderHash = await seaport.read.getOrderHash([orderComponents]);
      const startTime = 0n;
      const endTime = timestamp + 86400n;

      // bob gets server token
      // server is signing off on the restriction set
      const deadline = timestamp + 600n;
      const authParams = {
        orderHash: orderHash,
        fulfiller: bob.account.address,
        minFill: minFillCap,
        maxFill: bobFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams,
      });
      const serverToken = {
        deadline: deadline,
        signature: serverSignature,
      };

      // get extra data
      const encodedExtraData = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: bobFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken,
          },
        ]
      );

      // construct advanced order
      const advancedOrder = {
        parameters: orderParameters,
        numerator: (wethTradeamount * 3n) / 10n, // fill 30%
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };

      // bob fills the first 30%
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        (wethTradeamount * 3n) / 10n
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        (usdcTradeAmount * 7n) / 10n
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        (usdcTradeAmount * 3n) / 10n
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        (wethTradeamount * 7n) / 10n
      );

      // bob tries to fill another 20%
      // this puts him over his fill cap
      const badOrder = {
        parameters: orderParameters,
        numerator: (wethTradeamount * 2n) / 10n,
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };
      await expect(
        (
          await getSeaport(bob)
        ).write.fulfillAdvancedOrder([
          badOrder,
          [],
          zeroHash,
          bob.account.address,
        ])
      ).to.be.rejectedWith("MAX_FILL_EXCEEDED");
    });

    /*
        Check min fill amount is enforced
    */
    it("multiple partial fills, under min fill", async function () {
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
        restrictToAddressesZone,
        server,
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob and charlie can fill the trade
      // alice, bob, and charlie approve seaport contract
      await (
        await getUsdc(alice)
      ).write.approve([seaportAddress, usdcTradeAmount]);
      await (
        await getWeth(bob)
      ).write.approve([seaportAddress, wethTradeamount]);
      await (
        await getWeth(charlie)
      ).write.approve([seaportAddress, wethTradeamount]);

      // fill caps
      const bobFillCap = (usdcTradeAmount * 4n) / 10n;
      const charlieFillCap = (usdcTradeAmount * 6n) / 10n;
      const minFillCap = bobFillCap;

      // construct order
      const salt = generateSalt();
      const baseOrderParameters = {
        offerer: alice.account.address,
        zone: restrictToAddressesZone.address,

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
        orderType: 3, // partial restricted
        startTime: timestamp,
        endTime: timestamp + 86400n, // 24 hours from now

        zoneHash: zeroHash,

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

      // get order data
      const sigDomainData = {
        name: await restrictToAddressesZone.read._NAME(),
        version: await restrictToAddressesZone.read._VERSION(),
        chainId: 31337,
        verifyingContract: restrictToAddressesZone.address,
      };
      const orderHash = await seaport.read.getOrderHash([orderComponents]);
      const startTime = 0n;
      const endTime = timestamp + 86400n;

      // bob gets server token
      // server is signing off on the restriction set
      const deadline = timestamp + 600n;
      const authParams = {
        orderHash: orderHash,
        fulfiller: bob.account.address,
        minFill: minFillCap,
        maxFill: bobFillCap,
        deadline: deadline, // 10 mins from now
      };
      const serverSignature = await server.signTypedData({
        domain: sigDomainData,
        types: serverSignatureTypeV4,
        primaryType: "RestrictBySignatureV4AuthParams",
        message: authParams,
      });
      const serverToken = {
        deadline: deadline,
        signature: serverSignature,
      };

      // get extra data
      const encodedExtraData = encodeAbiParameters(
        [
          {
            name: "RestrictBySignatureV4ExtraData",
            type: "tuple",
            components: [
              { name: "minFill", type: "uint256" },
              { name: "maxFill", type: "uint256" },
              { name: "startTimestamp", type: "uint256" },
              { name: "endTimestamp", type: "uint256" },
              {
                name: "serverToken",
                type: "tuple",
                components: [
                  { name: "deadline", type: "uint256" },
                  { name: "signature", type: "bytes" },
                ],
              },
            ],
          },
        ],
        [
          {
            minFill: minFillCap,
            maxFill: bobFillCap,
            startTimestamp: startTime,
            endTimestamp: endTime,
            serverToken: serverToken,
          },
        ]
      );

      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        aliceStartingUsdcBalance
      );
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        startingWethBalance
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob tries to fill only 20%
      // this puts him under his min fill
      const badOrder = {
        parameters: orderParameters,
        numerator: (wethTradeamount * 2n) / 10n,
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };
      await expect(
        (
          await getSeaport(bob)
        ).write.fulfillAdvancedOrder([
          badOrder,
          [],
          zeroHash,
          bob.account.address,
        ])
      ).to.be.rejectedWith("UNDER_MIN_FILL");

      // because max fill and min fill are the same, bob must fill exactly that amount
      const advancedOrder = {
        parameters: orderParameters,
        numerator: (wethTradeamount * 4n) / 10n, // fill 40%
        denominator: wethTradeamount,
        signature: signature,
        extraData: encodedExtraData,
      };
      await (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(
        (wethTradeamount * 4n) / 10n
      );
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
        (usdcTradeAmount * 6n) / 10n
      );
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
        (usdcTradeAmount * 4n) / 10n
      );
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(
        (wethTradeamount * 6n) / 10n
      );
    });
  });
});
