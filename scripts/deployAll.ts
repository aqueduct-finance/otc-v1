/**
 *
 * Deploys all zones
 *
 * to run: npx hardhat run --network ____ scripts/deployAll.ts
 *
 */

import hre from "hardhat";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * @notice this address should be the same on all chains,
 * but you can confirm the address in the readme here:
 * https://github.com/ProjectOpenSea/seaport
 */
const seaportAddress = '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC';

/**
 * @notice this example address is for sepolia
 * - change this when deploying to other chains
 */
const timeLockAddress = '0x3B9007eD3106fEA9821A657f930995A2F9A20C97';

/**
 * @notice this is the address that controls server signatures
 */
const serverSignatureAddress = '0xCe597c10BDbb2943E685453Bdefe6C4B090E8775';

const main = async () => {

    // get chain id
    const chainId = hre.network.config.chainId;
    console.log(`Using chainId ${chainId}, verify that this is correct.`)

    // deploy RequireServerSignature.sol
    const requireServerSignatureZone = await hre.viem.deployContract('RequireServerSignature', [serverSignatureAddress, chainId]);
    console.log('RequireServerSignature: ', requireServerSignatureZone.address)

    // wait for deployment and verify
    await delay(30000);
    await hre.run("verify:verify", {
        address: requireServerSignatureZone.address,
        constructorArguments: [serverSignatureAddress, chainId],
    });

    // deploy RestrictToAddresses.sol
    const restrictToAddressesZone = await hre.viem.deployContract('RestrictToAddresses', [seaportAddress]);
    console.log('RestrictToAddresses: ', restrictToAddressesZone.address)

    // wait for deployment and verify
    await delay(30000);
    await hre.run("verify:verify", {
        address: restrictToAddressesZone.address,
        constructorArguments: [seaportAddress],
    });

    // deploy RestrictToAddressesBySignature.sol
    const restrictToAddressesBySignatureZone = await hre.viem.deployContract('RestrictToAddressesBySignature');
    console.log('RestrictToAddressesBySignature: ', restrictToAddressesBySignatureZone.address)

    // wait for deployment and verify
    await delay(30000);
    await hre.run("verify:verify", {
        address: restrictToAddressesBySignatureZone.address,
        constructorArguments: [],
    });

    // deploy ZoneAggregator.sol
    const zoneAggregator = await hre.viem.deployContract('ZoneAggregator');
    console.log('ZoneAggregator: ', zoneAggregator.address)

    // wait for deployment and verify
    await delay(30000);
    await hre.run("verify:verify", {
        address: zoneAggregator.address,
        constructorArguments: [],
    });

    // deploy TimeLockHandler.sol
    const timeLockHandler = await hre.viem.deployContract('TimeLockHandler', [timeLockAddress]);
    console.log('TimeLockHandler: ', timeLockHandler.address)

    // wait for deployment and verify
    await delay(30000);
    await hre.run("verify:verify", {
        address: timeLockHandler.address,
        constructorArguments: [timeLockAddress],
    });
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