import hre from "hardhat";
import { seaportAddress } from "../utils/constants";

async function seaportFixture() {

    // seaport
    const seaport = await hre.viem.getContractAt(
      "SeaportInterface",
      seaportAddress
    );
    const [alice] = await hre.viem.getWalletClients();
    async function getSeaport(client: typeof alice) {
      return await hre.viem.getContractAt(
        "SeaportInterface",
        seaportAddress,
        {
          walletClient: client
        }
      );
    }

    return {
      seaport,
      getSeaport
    };
}

export default seaportFixture;