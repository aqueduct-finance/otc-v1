import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ETH_ALCHEMY_KEY}`,
      },
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
    ethereum: {
      chainId: 1,
      url: process.env.ETHEREUM_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
    polygon: {
      chainId: 137,
      url: process.env.POLYGON_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
    base: {
      chainId: 8453,
      url: process.env.BASE_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
    berachainTestnet: {
      chainId: 80085,
      url: process.env.BERACHAIN_TESTNET_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
    arbitrum: {
      chainId: 42161,
      url: process.env.ARBITRUM_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
    bsc: {
      chainId: 56,
      url: process.env.BSC_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY ?? "",
      ethereum: process.env.ETHERSCAN_API_KEY ?? "",
      sepolia: process.env.ETHERSCAN_API_KEY ?? "",
      polygon: process.env.POLYGONSCAN_API_KEY ?? "",
      base: process.env.BASESCAN_API_KEY ?? "",
      arbitrumOne: process.env.ARBITRUM_API_KEY ?? "",
      bsc: process.env.BSC_API_KEY ?? "",
    },
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
};

export default config;
