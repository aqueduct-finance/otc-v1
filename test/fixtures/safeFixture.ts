import hre from "hardhat";
import { Abi } from "viem";
import { GetContractReturnType } from "@nomicfoundation/hardhat-viem/types";

import { zeroAddress } from "../utils/constants";

const getRandomInt = (
  min = 0,
  max: number = Number.MAX_SAFE_INTEGER
): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const getRandomIntAsString = (
  min = 0,
  max: number = Number.MAX_SAFE_INTEGER
): string => {
  return getRandomInt(min, max).toString();
};

const getSafeSingleton = async () => {
  const safe = await hre.viem.deployContract("Safe");
  return safe;
};

const getSafeTemplateWithSingleton = async (
  singleton: GetContractReturnType<Abi>,
  saltNumber: string = getRandomIntAsString()
) => {
  const singletonAddress = singleton.address;
  const factory = await hre.viem.deployContract("SafeProxyFactory");
  const { result: template } = await (
    await hre.viem.getPublicClient()
  ).simulateContract({
    address: factory.address,
    abi: factory.abi,
    functionName: "createProxyWithNonce",
    args: [singletonAddress, "0x", BigInt(saltNumber)],
  });
  await factory.write.createProxyWithNonce([
    singletonAddress,
    "0x",
    BigInt(saltNumber),
  ]);
  return await hre.viem.getContractAt("Safe", template as `0x${string}`);
};

const getSafe = async (owners: `0x${string}`[]) => {
  const singleton = await getSafeSingleton();
  const threshold = owners.length;
  const to = zeroAddress;
  const data = "0x";
  const saltNumber = getRandomIntAsString();

  // fallback handler
  const fallbackHandlerContract = await hre.viem.deployContract(
    "CompatibilityFallbackHandler"
  );
  const fallbackHandler = fallbackHandlerContract.address;

  const template = await getSafeTemplateWithSingleton(
    singleton as unknown as GetContractReturnType<Abi>,
    saltNumber
  );
  await template.write.setup([
    owners,
    BigInt(threshold),
    to,
    data,
    fallbackHandler,
    zeroAddress,
    0n,
    zeroAddress,
  ]);

  return template;
};

async function safeFixture() {
  // get users
  const [alice] = await hre.viem.getWalletClients();

  // deploy safe
  const aliceSafe = await getSafe([alice.account.address]);

  return { aliceSafe };
}

export default safeFixture;
