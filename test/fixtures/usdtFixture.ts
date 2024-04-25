import hre, { network } from "hardhat";
import { usdtAddress } from "../utils/constants";
import { parseUnits, toHex } from "viem";

async function usdtFixture() {
  // get contract from eth mainnet
  const usdt = await hre.viem.getContractAt("IUSDT", usdtAddress);
  const [alice, bob] = await hre.viem.getWalletClients();
  async function getUsdt(client: typeof alice) {
    return await hre.viem.getContractAt("IUSDT", usdtAddress, {
      walletClient: client,
    });
  }

  // impersonate owner to issue tokens
  const ownerAddress = await usdt.read.getOwner();
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [ownerAddress],
  });
  const owner = await hre.viem.getWalletClient(ownerAddress);

  // ensure owner has enough eth
  await network.provider.request({
    method: "hardhat_setBalance",
    params: [owner.account.address, toHex(parseUnits("1", 18))],
  });

  // set alice and bob's balances to 0
  await (await getUsdt(owner)).write.addBlackList([alice.account.address]);
  await (await getUsdt(owner)).write.destroyBlackFunds([alice.account.address]);
  await (await getUsdt(owner)).write.removeBlackList([alice.account.address]);
  await (await getUsdt(owner)).write.addBlackList([bob.account.address]);
  await (await getUsdt(owner)).write.destroyBlackFunds([bob.account.address]);
  await (await getUsdt(owner)).write.removeBlackList([bob.account.address]);

  // issue tokens and transfer to alice
  const aliceStartingUsdtBalance = parseUnits("1000", 6);
  await (await getUsdt(owner)).write.issue([aliceStartingUsdtBalance]);
  await (
    await getUsdt(owner)
  ).write.transfer([alice.account.address, aliceStartingUsdtBalance]);

  return {
    usdt,
    getUsdt,
    aliceStartingUsdtBalance,
  };
}

export default usdtFixture;
