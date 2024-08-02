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
const seaportAddress = "0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC";

/**
 * @notice these example address are for sepolia
 * - change these when deploying to other chains
 */
const tokenLockupPlansAddress = "0xb49d0CD3D5290adb4aF1eBA7A6B90CdE8B9265ff";
const whitelistedLockups = [
  "0xb49d0CD3D5290adb4aF1eBA7A6B90CdE8B9265ff", // TokenLockupPlans
  "0xB82b292C9e33154636fe8839fDb6d4081Da5c359", // VotingTokenLockupPlans
];

/**
 * @notice this is the address that controls server signatures
 */
const serverSignatureAddress = "0xCe597c10BDbb2943E685453Bdefe6C4B090E8775";

const main = async () => {
  // get chain id
  const chainId = hre.network.config.chainId;
  console.log(`Using chainId ${chainId}, verify that this is correct.`);

  // deploy RequireServerSignature.sol
  const requireServerSignatureZone = await hre.viem.deployContract(
    "RequireServerSignature",
    [serverSignatureAddress, BigInt(chainId ?? 11155111)]
  );
  console.log("RequireServerSignature: ", requireServerSignatureZone.address);

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: requireServerSignatureZone.address,
    constructorArguments: [serverSignatureAddress, chainId],
  });

  // deploy RestrictToAddresses.sol
  const restrictToAddressesZone = await hre.viem.deployContract(
    "RestrictToAddresses",
    [seaportAddress]
  );
  console.log("RestrictToAddresses: ", restrictToAddressesZone.address);

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: restrictToAddressesZone.address,
    constructorArguments: [seaportAddress],
  });

  // deploy RestrictToAddressesBySignature.sol
  const restrictToAddressesBySignatureZone = await hre.viem.deployContract(
    "RestrictToAddressesBySignature"
  );
  console.log(
    "RestrictToAddressesBySignature: ",
    restrictToAddressesBySignatureZone.address
  );

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: restrictToAddressesBySignatureZone.address,
    constructorArguments: [],
  });

  // deploy ZoneAggregator.sol
  const zoneAggregator = await hre.viem.deployContract("ZoneAggregator", [
    seaportAddress,
  ]);
  console.log("ZoneAggregator: ", zoneAggregator.address);

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: zoneAggregator.address,
    constructorArguments: [seaportAddress],
  });

  // deploy TokenLockupPlansHandler.sol
  const tokenLockupPlansHandler = await hre.viem.deployContract(
    "TokenLockupPlansHandler",
    [tokenLockupPlansAddress, seaportAddress, zoneAggregator.address]
  );
  console.log("TokenLockupPlansHandler: ", tokenLockupPlansHandler.address);

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: tokenLockupPlansHandler.address,
    constructorArguments: [
      tokenLockupPlansAddress,
      seaportAddress,
      zoneAggregator.address,
    ],
  });

  // deploy RestrictBySignatureV2.sol
  const restrictBySignatureV2Zone = await hre.viem.deployContract(
    "RestrictBySignatureV2",
    [serverSignatureAddress, BigInt(chainId ?? 11155111)]
  );
  console.log("RestrictBySignatureV2: ", restrictBySignatureV2Zone.address);

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: restrictBySignatureV2Zone.address,
    constructorArguments: [serverSignatureAddress, chainId],
  });

  // deploy TokenLockupPlansVerifier.sol
  const tokenLockupPlansVerifier = await hre.viem.deployContract(
    "TokenLockupPlansVerifier",
    [whitelistedLockups]
  );
  console.log("TokenLockupPlansVerifier: ", tokenLockupPlansVerifier.address);

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: tokenLockupPlansVerifier.address,
    constructorArguments: [whitelistedLockups],
  });

  // deploy OtcPool.sol
  const otcPool = await hre.viem.deployContract("OtcPool", []);
  console.log("OtcPool: ", otcPool.address);

  // wait for deployment and verify
  await delay(30000);
  await hre.run("verify:verify", {
    address: otcPool.address,
    constructorArguments: [],
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
