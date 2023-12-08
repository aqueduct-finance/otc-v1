import {loadFixture} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits } from 'viem';
import orderType from "./utils/orderType";
import { seaportAddress, zeroAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";

describe("Seaport ERC20 tests", function () {

  async function fixture() {
    const sf = await seaportFixture();
    const af = await accountsFixture();

    return {
      ...sf,
      ...af
    }
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
        startingWethBalance 
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice and bob approve seaport contract
      await (await getUsdc(alice)).write.approve([
        seaportAddress,
        usdcTradeAmount
      ]);
      await (await getWeth(bob)).write.approve([
        seaportAddress,
        wethTradeamount
      ]);

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
            }
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
            }
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
        totalOriginalConsiderationItems: 1n
      }

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
      }

      // alice signs the order
      const signature = await alice.signTypedData({
        domain: domainData,
        types: orderType,
        primaryType: 'OrderComponents',
        message: orderComponents
      });
      
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(aliceStartingUsdcBalance);
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(startingWethBalance);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      const order = {
        parameters: orderParameters,
        signature: signature
      };
      await (await getSeaport(bob)).write.fulfillOrder([
        order,
        zeroHash
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeamount);
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(usdcTradeAmount);
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
        startingWethBalance 
      } = await loadFixture(fixture);

      // amounts
      const timestamp = await getBlockTimestamp();
      const usdcTradeAmount = parseUnits("1000", 6);
      const wethTradeamount = parseUnits("1", 18);

      // alice will designate that only bob can fill the trade
      // alice and bob approve seaport contract
      await (await getUsdc(alice)).write.approve([
        seaportAddress,
        usdcTradeAmount
      ]);
      await (await getWeth(bob)).write.approve([
        seaportAddress,
        wethTradeamount
      ]);

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
            }
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
            }
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
        totalOriginalConsiderationItems: 1n
      }

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
      }

      // alice signs the order
      const signature = await alice.signTypedData({
        domain: domainData,
        types: orderType,
        primaryType: 'OrderComponents',
        message: orderComponents
      });
      const order = {
        parameters: orderParameters,
        signature: signature
      };

      // although alice intends for bob to fill the order,
      // let's pretend that charlie somehow intercepts alice's signed message
      // charlie should still not be able to fill the order
      await (await getWeth(charlie)).write.approve([
        seaportAddress,
        wethTradeamount
      ]);
      await expect(
        (await getSeaport(charlie)).write.fulfillOrder([
          order,
          zeroHash
        ])
      ).to.be.rejectedWith(
        'VM Exception while processing transaction: reverted with an unrecognized custom error'
      );
      
      // check that bob can swap
      // check for expected starting balances
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(aliceStartingUsdcBalance);
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(startingWethBalance);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

      // bob receives the signed order and fulfills it
      await (await getSeaport(bob)).write.fulfillOrder([
        order,
        zeroHash
      ]);

      // check that the swap was correct
      expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeamount);
      expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
      expect(await usdc.read.balanceOf([bob.account.address])).to.eq(usdcTradeAmount);
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);
    });
  });
});
