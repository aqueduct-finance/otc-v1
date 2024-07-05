import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits, encodeAbiParameters, keccak256 } from "viem";
import hre from "hardhat";
import orderType from "./utils/orderType";
import { seaportAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";
import serverSignatureType from "./utils/serverSignatureType";

describe("ZoneAggregator Zone tests", function () {
  async function fixture() {
    const sf = await seaportFixture();
    const af = await accountsFixture();

    // setup zones that we'll use

    // ZoneAggregator
    const zoneAggregator = await hre.viem.deployContract("ZoneAggregator", [
      sf.seaport.address,
    ]);

    // RequireServerSignature zone
    // set erin as the server owner
    const server = af.erin;
    const requireServerSignatureZone = await hre.viem.deployContract(
      "RequireServerSignature",
      [server.account.address, 31337n]
    );
    async function getRequireServerSignatureZone(client: typeof af.alice) {
      return await hre.viem.getContractAt(
        "IRequireServerSignature",
        requireServerSignatureZone.address,
        {
          walletClient: client,
        }
      );
    }

    // RestrictToAddressesBySignature zone
    const restrictToAddressesZone = await hre.viem.deployContract(
      "RestrictToAddressesBySignature"
    );

    return {
      ...sf,
      ...af,
      server,
      zoneAggregator,
      requireServerSignatureZone,
      getRequireServerSignatureZone,
      restrictToAddressesZone,
    };
  }

  /*
        Test restricting to a single zone as a base case

        This case wouldn't make any sense to use ZoneAggregator, but testing this anyways
    */
  async function baseCaseFixture() {
    const {
      alice,
      bob,
      charlie,
      server,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      aliceStartingUsdcBalance,
      startingWethBalance,
      restrictToAddressesZone,
      zoneAggregator,
    } = await fixture();

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeAmount = parseUnits("1", 18);

    // alice will designate that only bob and charlie can fill the trade
    // alice, bob, and charlie approve seaport contract
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (await getWeth(bob)).write.approve([seaportAddress, wethTradeAmount]);
    await (
      await getWeth(charlie)
    ).write.approve([seaportAddress, wethTradeAmount]);

    // compute zone hash

    // alice computes the merkle root
    // leaf nodes are just bob and charlie, so the root is the hash of those two
    const hashBob = keccak256(bob.account.address);
    const hashCharlie = keccak256(charlie.account.address);
    const concatenatedAddresses =
      hashBob < hashCharlie
        ? hashBob + hashCharlie.slice(2)
        : hashCharlie + hashBob.slice(2);
    const merkleRoot = keccak256(concatenatedAddresses as `0x${string}`);

    // construct list of zones and hash them to get the offerer's zoneHash
    const packedZones = restrictToAddressesZone.address + merkleRoot.slice(2);
    const encodedZonesHash = keccak256(packedZones as `0x${string}`);

    // construct order
    const salt = generateSalt();
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: zoneAggregator.address,

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
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: encodedZonesHash,
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

    // bob finds the hashes necessary to compute the merkle root from the hash of his address
    // in this case, just the hash of charlie's address
    const necessaryHashes = encodeAbiParameters(
      [{ type: "bytes32[]", name: "extraData" }],
      [[hashCharlie]]
    );

    // construct extraData
    const zonesData = [
      {
        zoneAddress: restrictToAddressesZone.address,
        zoneHash: merkleRoot,
        zoneExtraData: necessaryHashes,
      },
    ];
    const extraData = encodeAbiParameters(
      [
        {
          name: "zones",
          type: "tuple[]",
          components: [
            { name: "zoneAddress", type: "address" },
            { name: "zoneHash", type: "bytes32" },
            { name: "zoneExtraData", type: "bytes" },
          ],
        },
      ],
      [zonesData]
    );

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: wethTradeAmount,
      denominator: wethTradeAmount,
      signature: signature,
      extraData: extraData,
    };

    return {
      alice,
      bob,
      charlie,
      aliceStartingUsdcBalance,
      startingWethBalance,
      usdc,
      weth,
      getUsdc,
      getWeth,
      getSeaport,
      usdcTradeAmount,
      wethTradeAmount,
      advancedOrder,
      zonesData,
    };
  }

  /*
        Alice shares the correct ZoneData, and Bob supplies the correct extraData
    */
  it("base case: valid ZoneData, correct extraData", async function () {
    const {
      alice,
      bob,
      aliceStartingUsdcBalance,
      startingWethBalance,
      usdc,
      weth,
      getSeaport,
      usdcTradeAmount,
      wethTradeAmount,
      advancedOrder,
    } = await loadFixture(baseCaseFixture);

    // check for expected starting balances
    expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
      aliceStartingUsdcBalance
    );
    expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
    expect(await weth.read.balanceOf([bob.account.address])).to.eq(
      startingWethBalance
    );
    expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

    // bob fulfills the order
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
      wethTradeAmount
    );
    expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
    expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
      usdcTradeAmount
    );
    expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);
  });

  /*
        Test combining RequireServerSignature and RestrictToAddressesBySignature

        Two tests:
        - valid ZoneData, correct extraData
        - valid ZoneData, user tries to modify extraData
    */
  async function combinedFixture() {
    const {
      alice,
      bob,
      charlie,
      server,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      aliceStartingUsdcBalance,
      startingWethBalance,
      requireServerSignatureZone,
      restrictToAddressesZone,
      zoneAggregator,
    } = await fixture();

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeAmount = parseUnits("1", 18);

    // alice will designate that only bob and charlie can fill the trade
    // alice, bob, and charlie approve seaport contract
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (await getWeth(bob)).write.approve([seaportAddress, wethTradeAmount]);
    await (
      await getWeth(charlie)
    ).write.approve([seaportAddress, wethTradeAmount]);

    // compute zone hashes

    // alice computes the merkle root
    // leaf nodes are just bob and charlie, so the root is the hash of those two
    const hashBob = keccak256(bob.account.address);
    const hashCharlie = keccak256(charlie.account.address);
    const concatenatedAddresses =
      hashBob < hashCharlie
        ? hashBob + hashCharlie.slice(2)
        : hashCharlie + hashBob.slice(2);
    const merkleRoot = keccak256(concatenatedAddresses as `0x${string}`);

    // for RequireServerSignature, we don't need a zoneHash
    const serverSignatureZoneHash = zeroHash;

    // construct list of zones and hash them to get the offerer's zoneHash
    const packedZones =
      restrictToAddressesZone.address +
      merkleRoot.slice(2) +
      requireServerSignatureZone.address.slice(2) +
      serverSignatureZoneHash.slice(2);
    const encodedZonesHash = keccak256(packedZones as `0x${string}`);

    // construct order
    const salt = generateSalt();
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: zoneAggregator.address,

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
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: encodedZonesHash,
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

    // server signs the order
    const orderHash = await seaport.read.getOrderHash([orderComponents]);
    const authParams = {
      orderHash: orderHash,
      fulfiller: bob.account.address,
      deadline: timestamp + 600n, // 10 mins from now
    };
    const serverDomainData = {
      name: "RequireServerSignature",
      version: "1.0",
      chainId: 31337,
      verifyingContract: requireServerSignatureZone.address,
    };
    const serverSignature = await server.signTypedData({
      domain: serverDomainData,
      types: serverSignatureType,
      primaryType: "AuthParams",
      message: authParams,
    });
    const serverToken = {
      authParams: authParams,
      signature: serverSignature,
    };
    const encodedServerToken = encodeAbiParameters(
      [
        {
          name: "serverToken",
          type: "tuple",
          components: [
            {
              name: "authParams",
              type: "tuple",
              components: [
                { name: 'orderHash', type: 'bytes32' },
                { name: "fulfiller", type: "address" },
                { name: "deadline", type: "uint256" },
              ],
            },
            { name: "signature", type: "bytes" },
          ],
        },
      ],
      [serverToken]
    );

    // bob finds the hashes necessary to compute the merkle root from the hash of his address
    // in this case, just the hash of charlie's address
    const necessaryHashes = encodeAbiParameters(
      [{ type: "bytes32[]", name: "extraData" }],
      [[hashCharlie]]
    );

    // construct extraData
    const zonesData = [
      {
        zoneAddress: restrictToAddressesZone.address,
        zoneHash: merkleRoot,
        zoneExtraData: necessaryHashes,
      },
      {
        zoneAddress: requireServerSignatureZone.address,
        zoneHash: serverSignatureZoneHash,
        zoneExtraData: encodedServerToken,
      },
    ];
    const extraData = encodeAbiParameters(
      [
        {
          name: "zones",
          type: "tuple[]",
          components: [
            { name: "zoneAddress", type: "address" },
            { name: "zoneHash", type: "bytes32" },
            { name: "zoneExtraData", type: "bytes" },
          ],
        },
      ],
      [zonesData]
    );

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: wethTradeAmount,
      denominator: wethTradeAmount,
      signature: signature,
      extraData: extraData,
    };

    return {
      alice,
      bob,
      charlie,
      aliceStartingUsdcBalance,
      startingWethBalance,
      usdc,
      weth,
      getUsdc,
      getWeth,
      getSeaport,
      usdcTradeAmount,
      wethTradeAmount,
      advancedOrder,
      serverToken,
      zonesData,
    };
  }

  /*
        Alice shares the correct ZoneData, and Bob supplies the correct extraData
    */
  it("combined zones: valid ZoneData, correct extraData", async function () {
    const {
      alice,
      bob,
      aliceStartingUsdcBalance,
      startingWethBalance,
      usdc,
      weth,
      getSeaport,
      usdcTradeAmount,
      wethTradeAmount,
      advancedOrder,
    } = await loadFixture(combinedFixture);

    // check for expected starting balances
    expect(await usdc.read.balanceOf([alice.account.address])).to.eq(
      aliceStartingUsdcBalance
    );
    expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
    expect(await weth.read.balanceOf([bob.account.address])).to.eq(
      startingWethBalance
    );
    expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

    // bob fulfills the order
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
      wethTradeAmount
    );
    expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
    expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
      usdcTradeAmount
    );
    expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);
  });

  /*
        Alice shares the correct ZoneData, and Bob tries to modify it
    */
  it("combined zones: valid ZoneData, user tries to modify extraData", async function () {
    const { bob, getSeaport, advancedOrder, zonesData } = await loadFixture(
      combinedFixture
    );

    // bob might try to modify the merkle root for the RestrictToAddressesZone check
    // this would allow him to fill the trade if he was not included
    zonesData[0].zoneHash = keccak256(bob.account.address);
    zonesData[0].zoneExtraData = encodeAbiParameters(
      [{ name: "extraData", type: "bytes32[]" }],
      [[]]
    );
    const extraData = encodeAbiParameters(
      [
        {
          name: "zones",
          type: "tuple[]",
          components: [
            { name: "zoneAddress", type: "address" },
            { name: "zoneHash", type: "bytes32" },
            { name: "zoneExtraData", type: "bytes" },
          ],
        },
      ],
      [zonesData]
    );
    advancedOrder.extraData = extraData;

    // bob fulfills the order
    await expect(
      (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ])
    ).to.be.rejectedWith("INVALID_ZONES");
  });
});
