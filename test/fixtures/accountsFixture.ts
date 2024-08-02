import hre from "hardhat";
import { parseUnits } from 'viem';

async function accountsFixture() {
    
    // get users
    const [alice, bob, charlie, dan, erin, frank] = await hre.viem.getWalletClients();

    // deploy tokens for testing
    const _usdc = await hre.viem.deployContract('ERC20', ['USDC', 'USDC']);
    const _weth = await hre.viem.deployContract('ERC20', ['WETH', 'WETH']);
    const usdc = await hre.viem.getContractAt(
      "contracts/tokens/interfaces/IERC20.sol:IERC20",
      _usdc.address
    );
    const weth = await hre.viem.getContractAt(
      "contracts/tokens/interfaces/IERC20.sol:IERC20",
      _weth.address
    );
    async function getUsdc(client: typeof alice) {
      return await hre.viem.getContractAt(
        "contracts/tokens/interfaces/IERC20.sol:IERC20",
        _usdc.address,
        {
          walletClient: client
        }
      );
    }
    async function getWeth(client: typeof alice) {
      return await hre.viem.getContractAt(
        "contracts/tokens/interfaces/IERC20.sol:IERC20",
        _weth.address,
        {
          walletClient: client
        }
      );
    }

    // mint tokens to each account
    const aliceStartingUsdcBalance = parseUnits("1000", 6);
    const startingWethBalance = parseUnits("1", 18);
    await (await getUsdc(alice)).write.mint([
        alice.account.address,
        aliceStartingUsdcBalance
    ]);
    await (await getWeth(bob)).write.mint([
        bob.account.address,
        startingWethBalance
    ]);
    await (await getWeth(charlie)).write.mint([
        charlie.account.address,
        startingWethBalance
    ]);
    await (await getWeth(dan)).write.mint([
        dan.account.address,
        startingWethBalance
    ]);
    await (await getWeth(erin)).write.mint([
        erin.account.address,
        startingWethBalance
    ]);

    return {
      alice,
      bob,
      charlie,
      dan,
      erin,
      frank,
      usdc,
      weth,
      getUsdc,
      getWeth,
      aliceStartingUsdcBalance,
      startingWethBalance
    };
}

export default accountsFixture;