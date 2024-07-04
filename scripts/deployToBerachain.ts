/**
 *
 * Deploys RestrictToAddressesBySignature to berachain testnet
 *
 * to run: npx hardhat run --network berachainTestnet scripts/deployToBerachain.ts
 *
 */

import hre from "hardhat";
import { defineChain } from "viem";
import { privateKeyToAccount } from 'viem/accounts';

const chainConfiguration = defineChain({
  id: 80085,
  name: "berachainArtio",
  network: "berachainArtio",
  nativeCurrency: {
    decimals: 18,
    name: "BERA Token",
    symbol: "BERA",
  },
  rpcUrls: {
    default: {
      http: [`${process.env.BERACHAIN_TESTNET_URL}`],
    },
    public: {
      http: [`${process.env.BERACHAIN_TESTNET_URL}`],
    },
  },
  blockExplorers: {
    default: {
      name: "Beratrail",
      url: "https://artio.beratrail.io/",
    },
  },
});

const main = async () => {
  // get chain id
  const chainId = hre.network.config.chainId;
  console.log(`Using chainId ${chainId}, verify that this is correct.`);

  const publicClient = await hre.viem.getPublicClient({
    chain: chainConfiguration,
  });
  const walletClient = await hre.viem.getWalletClient(
    // @ts-ignore
    privateKeyToAccount(hre.network.config.accounts?.[0] as `0x${string}`) as unknown as `0x${string}`, 
    { 
      chain: chainConfiguration 
    } 
  ); 

  // deploy RestrictToAddressesBySignature.sol
  const restrictToAddressesBySignatureZone = await hre.viem.deployContract(
    "RestrictToAddressesBySignature",
    undefined,
    {
      publicClient: publicClient,
      walletClient: walletClient,
    }
  );
  console.log(
    "RestrictToAddressesBySignature: ",
    restrictToAddressesBySignatureZone.address
  );
};

const runMain = async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.log("Error deploying contract", error);
    process.exit(1);
  }
};

runMain();
