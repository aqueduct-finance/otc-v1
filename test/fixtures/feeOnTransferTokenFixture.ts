import hre from "hardhat";
import { parseUnits } from "viem";

async function feeOnTransferTokenFixture() {
  // get users
  const [alice] = await hre.viem.getWalletClients();

  // deploy tokens for testing
  const _feeOnTransferToken = await hre.viem.deployContract(
    "FeeOnTransferToken",
    ["FOTT", "FOTT"]
  );
  const feeOnTransferToken = await hre.viem.getContractAt(
    "contracts/tokens/interfaces/IERC20.sol:IERC20",
    _feeOnTransferToken.address
  );
  async function getFeeOnTransferToken(client: typeof alice) {
    return await hre.viem.getContractAt(
      "contracts/tokens/interfaces/IERC20.sol:IERC20",
      _feeOnTransferToken.address,
      {
        walletClient: client,
      }
    );
  }

  // mint tokens to each account
  const aliceStartingFeeTokenBalance = parseUnits("1000", 6);
  const mintAmount = (aliceStartingFeeTokenBalance * 100n) / 99n + 1n;
  await (
    await getFeeOnTransferToken(alice)
  ).write.mint([alice.account.address, mintAmount]);

  return {
    _feeOnTransferToken,
    feeOnTransferToken,
    getFeeOnTransferToken,
    aliceStartingFeeTokenBalance,
  };
}

export default feeOnTransferTokenFixture;
