import hre from "hardhat";
import { lockupAddress } from "../utils/constants";

async function lockupFixture() {

    const lockup = await hre.viem.getContractAt(
      "ITokenLockupPlans",
      lockupAddress
    );
    const [alice] = await hre.viem.getWalletClients();
    async function getLockup(client: typeof alice) {
      return await hre.viem.getContractAt(
        "ITokenLockupPlans",
        lockupAddress,
        {
          walletClient: client
        }
      );
    }

    return {
      lockup,
      getLockup
    };
}

export default lockupFixture;