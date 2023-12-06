import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseUnits } from 'viem' 
import crypto from 'crypto';
import orderType from "./utils/orderType";
import { seaportAddress, zeroAddress, zeroHash } from "./utils/constants";

describe("Seaport ERC20 tests", function () {
  async function getBlockTimestamp(): Promise<bigint> {
    const pc = await hre.viem.getPublicClient();
    const block = await pc.getBlock();
    return block.timestamp;
  }

  function generateSalt(): bigint {
    const randomBytes = crypto.randomBytes(32); // 32 bytes = 256 bits
    return BigInt('0x' + randomBytes.toString('hex'));
  }

  async function fixture() {
    
    // config users
    const [alice, bob] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // seaport
    const seaport = await hre.viem.getContractAt(
      "SeaportInterface",
      seaportAddress
    );
    async function getSeaport(client: typeof alice) {
      return await hre.viem.getContractAt(
        "SeaportInterface",
        seaportAddress,
        {
          walletClient: client
        }
      );
    }

    // deploy tokens for testing
    const _usdc = await hre.viem.deployContract('ERC20', ['USDC', 'USDC']);
    const _weth = await hre.viem.deployContract('ERC20', ['WETH', 'WETH']);
    const usdc = await hre.viem.getContractAt(
      "IERC20",
      _usdc.address
    );
    const weth = await hre.viem.getContractAt(
      "IERC20",
      _weth.address
    );
    async function getUsdc(client: typeof alice) {
      return await hre.viem.getContractAt(
        "IERC20",
        _usdc.address,
        {
          walletClient: client
        }
      );
    }
    async function getWeth(client: typeof alice) {
      return await hre.viem.getContractAt(
        "IERC20",
        _weth.address,
        {
          walletClient: client
        }
      );
    }

    // mint tokens to each account
    const aliceStartingUsdcBalance = parseUnits("1000", 6);
    const bobStartingWethBalance = parseUnits("1", 18);
    await (await getUsdc(alice)).write.mint([
      alice.account.address,
      aliceStartingUsdcBalance
    ]);
    await (await getWeth(bob)).write.mint([
      bob.account.address,
      bobStartingWethBalance
    ]);

    return {
      alice,
      bob,
      publicClient,
      seaport,
      usdc,
      weth,
      getSeaport,
      getUsdc,
      getWeth,
      aliceStartingUsdcBalance,
      bobStartingWethBalance
    };
  }

  describe("erc20<->erc20", function () {
    it("any recipient, complete fill", async function () {
      const { alice, bob, seaport, usdc, weth, getSeaport, getUsdc, getWeth, aliceStartingUsdcBalance, bobStartingWethBalance } = await loadFixture(fixture);

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
      expect(await weth.read.balanceOf([bob.account.address])).to.eq(bobStartingWethBalance);
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
  });
});
