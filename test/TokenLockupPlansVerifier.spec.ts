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

describe("TokenLockupPlansVerifier tests", function () {
  async function fixture() {
    const sf = await seaportFixture();
    const af = await accountsFixture();
    const lf = await lockupFixture();

    const lockupVerifier = await hre.viem.deployContract(
      "TokenLockupPlansVerifier",
      [[lf.lockup.address]]
    );

    return {
      ...sf,
      ...af,
      ...lf,
      lockupVerifier,
    };
  }

  /*
    Bob locks 1 weth, alice offers 1000 usdc for that locked position, bob fills
  */
  it("basic tokens<->lockup trade", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockup,
      getLockup,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // bob approves lockup contract to spend his weth
    await (await getWeth(bob)).write.approve([lockup.address, wethTradeamount]);

    // bob shouldn't have any weth locked yet
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);

    // bob creates a lockup
    const bobLockupParams = {
      token: weth.address,
      amount: wethTradeamount,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: 1n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    bobLockupParams.planId = await (
      await getLockup(bob)
    ).write.createPlan([
      bob.account.address,
      bobLockupParams.token,
      bobLockupParams.amount,
      bobLockupParams.start,
      bobLockupParams.cliff,
      bobLockupParams.rate,
      bobLockupParams.period,
    ]);
    expect(bobLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);

    // get token id
    bobLockupParams.tokenId = await (
      await getLockup(bob)
    ).read.tokenOfOwnerByIndex([bob.account.address, 0n]);
    expect(bobLockupParams.tokenId).to.not.equal(0n);

    // let's imagine that bob shares the token id with alice

    // alice approves seaport to spend her usdc and bob approves it to spend his locked position
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (
      await getLockup(bob)
    ).write.approve([seaportAddress, bobLockupParams.tokenId]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [],
          considerationAmounts: [bobLockupParams.amount],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

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
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: bobLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
          recipient: alice.account.address,
        },
      ],
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // bob receives the signed order and fulfills it
    await (
      await getSeaport(bob)
    ).write.fulfillAdvancedOrder([
      advancedOrder,
      [],
      zeroHash,
      bob.account.address,
    ]);

    // check usdc was swapped
    expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
    expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
      usdcTradeAmount
    );

    // alice should have the locked weth and bob shouldn't have any
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);
  });

  /*
    Alice locks and offers 1000 usdc, Bob locks and offers 1 weth, bob fills 
  */
  it("basic lockup<->lockup trade", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockup,
      getLockup,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // alice approves lockup contract to spend her usdc
    await (
      await getUsdc(alice)
    ).write.approve([lockup.address, usdcTradeAmount]);

    // alice shouldn't have any usdc locked yet
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, usdc.address])
    ).to.eq(0n);

    // alice creates a lockup
    const aliceLockupParams = {
      token: usdc.address,
      amount: usdcTradeAmount,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: usdcTradeAmount / 1000000n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    aliceLockupParams.planId = await (
      await getLockup(alice)
    ).write.createPlan([
      alice.account.address,
      aliceLockupParams.token,
      aliceLockupParams.amount,
      aliceLockupParams.start,
      aliceLockupParams.cliff,
      aliceLockupParams.rate,
      aliceLockupParams.period,
    ]);
    expect(aliceLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, usdc.address])
    ).to.eq(aliceLockupParams.amount);

    // get token id
    aliceLockupParams.tokenId = await (
      await getLockup(alice)
    ).read.tokenOfOwnerByIndex([alice.account.address, 0n]);
    expect(aliceLockupParams.tokenId).to.not.equal(0n);

    // bob approves lockup contract to spend his weth
    await (await getWeth(bob)).write.approve([lockup.address, wethTradeamount]);

    // bob shouldn't have any weth locked yet
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);

    // bob creates a lockup
    const bobLockupParams = {
      token: weth.address,
      amount: wethTradeamount,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: 1n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    bobLockupParams.planId = await (
      await getLockup(bob)
    ).write.createPlan([
      bob.account.address,
      bobLockupParams.token,
      bobLockupParams.amount,
      bobLockupParams.start,
      bobLockupParams.cliff,
      bobLockupParams.rate,
      bobLockupParams.period,
    ]);
    expect(bobLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);

    // get token id
    bobLockupParams.tokenId = await (
      await getLockup(bob)
    ).read.tokenOfOwnerByIndex([bob.account.address, 0n]);
    expect(bobLockupParams.tokenId).to.not.equal(0n);

    // let's imagine that bob shares the token id with alice

    // alice approves seaport to spend her locked usdc and bob approves it to spend his locked weth
    await (
      await getLockup(alice)
    ).write.approve([seaportAddress, aliceLockupParams.tokenId]);
    await (
      await getLockup(bob)
    ).write.approve([seaportAddress, bobLockupParams.tokenId]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [aliceLockupParams.amount],
          considerationAmounts: [bobLockupParams.amount],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

      // this is what the trader is giving
      offer: [
        {
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: aliceLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
        },
      ],

      // what the trader expects to receive
      consideration: [
        {
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: bobLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
          recipient: alice.account.address,
        },
      ],
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // bob receives the signed order and fulfills it
    await (
      await getSeaport(bob)
    ).write.fulfillAdvancedOrder([
      advancedOrder,
      [],
      zeroHash,
      bob.account.address,
    ]);

    // alice should have the locked weth and bob should have the locked usdc
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, usdc.address])
    ).to.eq(aliceLockupParams.amount);
  });

  it("tokens<->multiple lockups trade", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockup,
      getLockup,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // bob approves lockup contract to spend his weth
    await (await getWeth(bob)).write.approve([lockup.address, wethTradeamount]);

    // bob shouldn't have any weth locked yet
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);

    // bob creates a lockup
    const bobLockupParams = {
      token: weth.address,
      amount: wethTradeamount / 2n,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: 1n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    bobLockupParams.planId = await (
      await getLockup(bob)
    ).write.createPlan([
      bob.account.address,
      bobLockupParams.token,
      bobLockupParams.amount,
      bobLockupParams.start,
      bobLockupParams.cliff,
      bobLockupParams.rate,
      bobLockupParams.period,
    ]);
    expect(bobLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);

    // get token id
    bobLockupParams.tokenId = await (
      await getLockup(bob)
    ).read.tokenOfOwnerByIndex([bob.account.address, 0n]);
    expect(bobLockupParams.tokenId).to.not.equal(0n);

    // bob creates another lockup
    const bobLockupParams2 = {
      token: weth.address,
      amount: wethTradeamount / 2n,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: 1n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    bobLockupParams2.planId = await (
      await getLockup(bob)
    ).write.createPlan([
      bob.account.address,
      bobLockupParams2.token,
      bobLockupParams2.amount,
      bobLockupParams2.start,
      bobLockupParams2.cliff,
      bobLockupParams2.rate,
      bobLockupParams2.period,
    ]);
    expect(bobLockupParams2.planId).to.not.equal("");

    // check that all weth is locked
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(wethTradeamount);

    // get token id of second lockup
    bobLockupParams2.tokenId = await (
      await getLockup(bob)
    ).read.tokenOfOwnerByIndex([bob.account.address, 1n]);
    expect(bobLockupParams2.tokenId).to.not.equal(0n);

    // let's imagine that bob shares these token ids with alice

    // alice approves seaport to spend her usdc and bob approves it to spend his locked positions
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (
      await getLockup(bob)
    ).write.approve([seaportAddress, bobLockupParams.tokenId]);
    await (
      await getLockup(bob)
    ).write.approve([seaportAddress, bobLockupParams2.tokenId]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [],
          considerationAmounts: [
            bobLockupParams.amount,
            bobLockupParams2.amount,
          ],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

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
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: bobLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
          recipient: alice.account.address,
        },
        {
          itemType: 2,
          token: lockup.address,
          identifierOrCriteria: bobLockupParams2.tokenId,
          startAmount: 1n,
          endAmount: 1n,
          recipient: alice.account.address,
        },
      ],
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // bob receives the signed order and fulfills it
    await (
      await getSeaport(bob)
    ).write.fulfillAdvancedOrder([
      advancedOrder,
      [],
      zeroHash,
      bob.account.address,
    ]);

    // check usdc was swapped
    expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
    expect(await usdc.read.balanceOf([bob.account.address])).to.eq(
      usdcTradeAmount
    );

    // alice should have the locked weth and bob shouldn't have any
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, weth.address])
    ).to.eq(wethTradeamount);
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);
  });

  /*
    Bob locks 1 weth, alice offers 1000 usdc for that locked position, bob fills
    Before filling, bob removes some of the vested weth
    We expect that this will invalidate the order
  */
  it("tokens<->lockup, try to withdraw tokens after signing order", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockup,
      getLockup,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // bob approves lockup contract to spend his weth
    await (await getWeth(bob)).write.approve([lockup.address, wethTradeamount]);

    // bob shouldn't have any weth locked yet
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);

    // bob creates a lockup
    const bobLockupParams = {
      token: weth.address,
      amount: wethTradeamount,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: wethTradeamount / 1000000n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    bobLockupParams.planId = await (
      await getLockup(bob)
    ).write.createPlan([
      bob.account.address,
      bobLockupParams.token,
      bobLockupParams.amount,
      bobLockupParams.start,
      bobLockupParams.cliff,
      bobLockupParams.rate,
      bobLockupParams.period,
    ]);
    expect(bobLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);

    // get token id
    bobLockupParams.tokenId = await (
      await getLockup(bob)
    ).read.tokenOfOwnerByIndex([bob.account.address, 0n]);
    expect(bobLockupParams.tokenId).to.not.equal(0n);

    // let's imagine that bob shares the token id with alice

    // alice approves seaport to spend her usdc and bob approves it to spend his locked position
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (
      await getLockup(bob)
    ).write.approve([seaportAddress, bobLockupParams.tokenId]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [],
          considerationAmounts: [bobLockupParams.amount],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

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
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: bobLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
          recipient: alice.account.address,
        },
      ],
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // go forward in time so some of the plan vests
    await time.increase(1000n);

    // before filling, bob removes half of his tokens
    await (await getLockup(bob)).write.redeemAllPlans();
    const remainingLockupAmount =
      bobLockupParams.amount -
      (await weth.read.balanceOf([bob.account.address]));
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(remainingLockupAmount);

    // bob receives the signed order and tries to fulfill it
    await expect(
      (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ])
    ).to.be.rejectedWith("LOCKUP_INVALID_AMOUNT");
  });

  /*
    Alice locks 1000usdc, alice offers the locked position for 1 weth, bob fills
    Before filling, alice removes some of the vested usdc
    We expect that this will invalidate the order
  */
  it("lockup<->tokens, try to withdraw tokens after signing order", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockup,
      getLockup,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // alice approves lockup contract to spend her usdc
    await (
      await getUsdc(alice)
    ).write.approve([lockup.address, usdcTradeAmount]);

    // alice shouldn't have any usdc locked yet
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, usdc.address])
    ).to.eq(0n);

    // alice creates a lockup
    const aliceLockupParams = {
      token: usdc.address,
      amount: usdcTradeAmount,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: usdcTradeAmount / 1000000n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    aliceLockupParams.planId = await (
      await getLockup(alice)
    ).write.createPlan([
      alice.account.address,
      aliceLockupParams.token,
      aliceLockupParams.amount,
      aliceLockupParams.start,
      aliceLockupParams.cliff,
      aliceLockupParams.rate,
      aliceLockupParams.period,
    ]);
    expect(aliceLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, usdc.address])
    ).to.eq(aliceLockupParams.amount);

    // get token id
    aliceLockupParams.tokenId = await (
      await getLockup(alice)
    ).read.tokenOfOwnerByIndex([alice.account.address, 0n]);
    expect(aliceLockupParams.tokenId).to.not.equal(0n);

    // alice approves seaport to spend her locked usdc and bob approves it to spend his weth
    await (await getWeth(bob)).write.approve([seaportAddress, wethTradeamount]);
    await (
      await getLockup(alice)
    ).write.approve([seaportAddress, aliceLockupParams.tokenId]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [aliceLockupParams.amount],
          considerationAmounts: [],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

      // this is what the trader is giving
      offer: [
        {
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: aliceLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
        },
      ],

      // what the trader expects to receive
      consideration: [
        {
          itemType: 1, // 1 == erc20
          token: weth.address,
          identifierOrCriteria: 0n, // criteria not used for erc20s
          startAmount: wethTradeamount,
          endAmount: wethTradeamount,
          recipient: alice.account.address,
        },
      ],
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // go forward in time so some of the plan vests
    await time.increase(1000n);

    // before filling, alice removes half of her tokens
    await (await getLockup(alice)).write.redeemAllPlans();
    const remainingLockupAmount =
      aliceLockupParams.amount -
      (await usdc.read.balanceOf([alice.account.address]));
    expect(
      await (
        await getLockup(alice)
      ).read.lockedBalances([alice.account.address, usdc.address])
    ).to.eq(remainingLockupAmount);

    // bob receives the signed order and tries to fulfill it
    await expect(
      (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ])
    ).to.be.rejectedWith("LOCKUP_INVALID_AMOUNT");
  });

  it("consideration is token but offerer tries to verify amount", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // approvals
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (await getWeth(bob)).write.approve([seaportAddress, wethTradeamount]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [],
          considerationAmounts: [wethTradeamount],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

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
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // previously this would revert, but should be fine to fulfill now
    // bob receives the signed order and fulfills it
    await (
      await getSeaport(bob)
    ).write.fulfillAdvancedOrder([
      advancedOrder,
      [],
      zeroHash,
      bob.account.address,
    ]);
  });

  it("offer is token but fulfiller tries to verify amount", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // approvals
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (await getWeth(bob)).write.approve([seaportAddress, wethTradeamount]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [wethTradeamount],
          considerationAmounts: [],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

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
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // previously this would revert, but should be fine to fulfill now
    // bob receives the signed order and fulfills it
    await (
      await getSeaport(bob)
    ).write.fulfillAdvancedOrder([
      advancedOrder,
      [],
      zeroHash,
      bob.account.address,
    ]);
  });

  it("fulfiller tries to modify lockup params", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockup,
      getLockup,
      lockupVerifier,
    } = await loadFixture(fixture);

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // bob approves lockup contract to spend his weth
    await (await getWeth(bob)).write.approve([lockup.address, wethTradeamount]);

    // bob shouldn't have any weth locked yet
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);

    // bob creates a lockup
    const bobLockupParams = {
      token: weth.address,
      amount: wethTradeamount,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: 1n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    bobLockupParams.planId = await (
      await getLockup(bob)
    ).write.createPlan([
      bob.account.address,
      bobLockupParams.token,
      bobLockupParams.amount,
      bobLockupParams.start,
      bobLockupParams.cliff,
      bobLockupParams.rate,
      bobLockupParams.period,
    ]);
    expect(bobLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);

    // get token id
    bobLockupParams.tokenId = await (
      await getLockup(bob)
    ).read.tokenOfOwnerByIndex([bob.account.address, 0n]);
    expect(bobLockupParams.tokenId).to.not.equal(0n);

    // let's imagine that bob shares the token id with alice

    // alice approves seaport to spend her usdc and bob approves it to spend his locked position
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (
      await getLockup(bob)
    ).write.approve([seaportAddress, bobLockupParams.tokenId]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [],
          considerationAmounts: [bobLockupParams.amount],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

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
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: bobLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
          recipient: alice.account.address,
        },
      ],
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: hashedLockupParams,
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

    // bob modifies lockup params
    const badLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmount", type: "uint256" },
            { name: "considerationAmount", type: "uint256" },
          ],
        },
      ],
      [
        {
          offerAmount: 0n,
          considerationAmount: bobLockupParams.amount / 2n,
        },
      ]
    );

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: badLockupParams,
    };

    // bob tries to fill
    await expect(
      (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ])
    ).to.be.rejectedWith("INVALID_EXTRA_DATA");
  });

  it("lockup not on whitelist", async function () {
    const {
      alice,
      bob,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      lockup,
      getLockup,
    } = await loadFixture(fixture);

    // deploy lockup verifier with empty whitelist
    const lockupVerifier = await hre.viem.deployContract(
      "TokenLockupPlansVerifier",
      [[usdc.address]] // just use some random address
    );

    // amounts
    const timestamp = await getBlockTimestamp();
    const usdcTradeAmount = parseUnits("1000", 6);
    const wethTradeamount = parseUnits("1", 18);

    // bob approves lockup contract to spend his weth
    await (await getWeth(bob)).write.approve([lockup.address, wethTradeamount]);

    // bob shouldn't have any weth locked yet
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(0n);

    // bob creates a lockup
    const bobLockupParams = {
      token: weth.address,
      amount: wethTradeamount,
      start: timestamp,
      cliff: timestamp + 100n,
      rate: 1n,
      period: 1n,
      planId: "",
      tokenId: 0n,
    };
    bobLockupParams.planId = await (
      await getLockup(bob)
    ).write.createPlan([
      bob.account.address,
      bobLockupParams.token,
      bobLockupParams.amount,
      bobLockupParams.start,
      bobLockupParams.cliff,
      bobLockupParams.rate,
      bobLockupParams.period,
    ]);
    expect(bobLockupParams.planId).to.not.equal("");

    // check that it was locked
    expect(
      await (
        await getLockup(bob)
      ).read.lockedBalances([bob.account.address, weth.address])
    ).to.eq(bobLockupParams.amount);

    // get token id
    bobLockupParams.tokenId = await (
      await getLockup(bob)
    ).read.tokenOfOwnerByIndex([bob.account.address, 0n]);
    expect(bobLockupParams.tokenId).to.not.equal(0n);

    // let's imagine that bob shares the token id with alice

    // alice approves seaport to spend her usdc and bob approves it to spend his locked position
    await (
      await getUsdc(alice)
    ).write.approve([seaportAddress, usdcTradeAmount]);
    await (
      await getLockup(bob)
    ).write.approve([seaportAddress, bobLockupParams.tokenId]);

    // construct order
    const salt = generateSalt();
    const encodedLockupParams = encodeAbiParameters(
      [
        {
          name: "LockupVerificationParams",
          type: "tuple",
          components: [
            { name: "offerAmounts", type: "uint256[]" },
            { name: "considerationAmounts", type: "uint256[]" },
          ],
        },
      ],
      [
        {
          offerAmounts: [],
          considerationAmounts: [bobLockupParams.amount],
        },
      ]
    );
    const hashedLockupParams = keccak256(encodedLockupParams);
    const baseOrderParameters = {
      offerer: alice.account.address,
      zone: lockupVerifier.address,

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
          itemType: 2, // ERC721
          token: lockup.address,
          identifierOrCriteria: bobLockupParams.tokenId,
          startAmount: 1n,
          endAmount: 1n,
          recipient: alice.account.address,
        },
      ],
      orderType: 2, // full restricted
      startTime: timestamp,
      endTime: timestamp + 86400n, // 24 hours from now
      zoneHash: hashedLockupParams,
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

    // construct advanced order
    const advancedOrder = {
      parameters: orderParameters,
      numerator: 1n,
      denominator: 1n,
      signature: signature,
      extraData: encodedLockupParams,
    };

    // bob receives the signed order and tries to fulfill it
    await expect(
      (
        await getSeaport(bob)
      ).write.fulfillAdvancedOrder([
        advancedOrder,
        [],
        zeroHash,
        bob.account.address,
      ])
    ).to.be.rejectedWith("LOCKUP_NOT_WHITELISTED");
  });

  it("try to deploy with no whitelisted addresses", async function () {
    await expect(
      hre.viem.deployContract("TokenLockupPlansVerifier", [[]])
    ).to.be.rejectedWith("NO_WHITELISTED_ADDRESSES");
  });

  it("try to deploy with whitelisted zero address", async function () {
    await expect(
      hre.viem.deployContract("TokenLockupPlansVerifier", [[zeroAddress]])
    ).to.be.rejectedWith("WHITELISTED_ZERO_ADDRESS");
  });
});
