import hre from "hardhat";

async function getBlockTimestamp(): Promise<bigint> {
    const pc = await hre.viem.getPublicClient();
    const block = await pc.getBlock();
    return block.timestamp;
}

export default getBlockTimestamp;