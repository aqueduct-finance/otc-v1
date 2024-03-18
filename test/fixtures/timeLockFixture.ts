import hre from "hardhat";
import { timeLockAddress } from "../utils/constants";

async function timeLockFixture() {

    const timeLock = await hre.viem.getContractAt(
      "ITimeLock",
      timeLockAddress
    );
    const [alice] = await hre.viem.getWalletClients();
    async function getTimeLock(client: typeof alice) {
      return await hre.viem.getContractAt(
        "ITimeLock",
        timeLockAddress,
        {
          walletClient: client
        }
      );
    }

    return {
      timeLock,
      getTimeLock
    };
}

export default timeLockFixture;