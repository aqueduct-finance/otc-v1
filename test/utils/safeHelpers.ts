import hre from "hardhat";
import { Abi } from "viem";
import { GetContractReturnType } from "@nomicfoundation/hardhat-viem/types";
import { ethers } from "ethers";
import { expect } from "chai";

import { zeroAddress } from "./constants";

export interface MetaTransaction {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  operation: number;
}

export interface SafeTransaction extends MetaTransaction {
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: `0x${string}`;
  refundReceiver: `0x${string}`;
  nonce: bigint;
}

export interface SafeSignature {
  signer: string;
  data: string;
  // a flag to indicate if the signature is a contract signature and the data has to be appended to the dynamic part of signature bytes
  dynamic?: true;
}

export const buildSafeTransaction = (template: {
  to: `0x${string}`;
  value?: bigint;
  data?: `0x${string}`;
  operation?: number;
  safeTxGas?: bigint;
  baseGas?: bigint;
  gasPrice?: bigint;
  gasToken?: `0x${string}`;
  refundReceiver?: `0x${string}`;
  nonce: bigint;
}): SafeTransaction => {
  return {
    to: template.to,
    value: template.value || 0n,
    data: template.data || "0x",
    operation: template.operation || 0,
    safeTxGas: template.safeTxGas || 0n,
    baseGas: template.baseGas || 0n,
    gasPrice: template.gasPrice || 0n,
    gasToken: template.gasToken || zeroAddress,
    refundReceiver: template.refundReceiver || zeroAddress,
    nonce: template.nonce,
  };
};

export const buildSignatureBytes = (
  signatures: SafeSignature[]
): `0x${string}` => {
  const SIGNATURE_LENGTH_BYTES = 65;
  signatures.sort((left, right) =>
    left.signer.toLowerCase().localeCompare(right.signer.toLowerCase())
  );

  let signatureBytes = "0x";
  let dynamicBytes = "";
  for (const sig of signatures) {
    if (sig.dynamic) {
      /* 
                A contract signature has a static part of 65 bytes and the dynamic part that needs to be appended 
                at the end of signature bytes.
                The signature format is
                Signature type == 0
                Constant part: 65 bytes
                {32-bytes signature verifier}{32-bytes dynamic data position}{1-byte signature type}
                Dynamic part (solidity bytes): 32 bytes + signature data length
                {32-bytes signature length}{bytes signature data}
            */
      const dynamicPartPosition = (
        signatures.length * SIGNATURE_LENGTH_BYTES +
        dynamicBytes.length / 2
      )
        .toString(16)
        .padStart(64, "0");
      const dynamicPartLength = (sig.data.slice(2).length / 2)
        .toString(16)
        .padStart(64, "0");
      const staticSignature = `${sig.signer
        .slice(2)
        .padStart(64, "0")}${dynamicPartPosition}00`;
      const dynamicPartWithLength = `${dynamicPartLength}${sig.data.slice(2)}`;

      signatureBytes += staticSignature;
      dynamicBytes += dynamicPartWithLength;
    } else {
      signatureBytes += sig.data.slice(2);
    }
  }

  return (signatureBytes + dynamicBytes) as `0x${string}`;
};

export type ViemWalletClient = Awaited<
  ReturnType<typeof hre.viem.getWalletClients>
>[number];

export const EIP712_SAFE_TX_TYPE = {
  // "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
  SafeTx: [
    { type: "address", name: "to" },
    { type: "uint256", name: "value" },
    { type: "bytes", name: "data" },
    { type: "uint8", name: "operation" },
    { type: "uint256", name: "safeTxGas" },
    { type: "uint256", name: "baseGas" },
    { type: "uint256", name: "gasPrice" },
    { type: "address", name: "gasToken" },
    { type: "address", name: "refundReceiver" },
    { type: "uint256", name: "nonce" },
  ],
};

export const safeSignTypedData = async (
  signer: ViemWalletClient,
  safeAddress: `0x${string}`,
  safeTx: SafeTransaction
): Promise<SafeSignature> => {
  const domainData = {
    //name: name,
    //version: version,
    // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
    chainId: 31337,
    verifyingContract: safeAddress,
  };

  return {
    signer: signer.account.address,
    data: await signer.signTypedData({
      domain: domainData,
      types: EIP712_SAFE_TX_TYPE,
      primaryType: "SafeTx",
      // @ts-ignore
      message: safeTx,
    }),
  };
};

export const executeTx = async (
  safe: any,
  safeTx: SafeTransaction,
  signatures: SafeSignature[]
) => {
  const typedSafe = safe as GetContractReturnType<Abi>;
  const signatureBytes = buildSignatureBytes(signatures);
  return typedSafe.write.execTransaction([
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    signatureBytes,
  ]);
};

export const EIP712_SAFE_MESSAGE_TYPE = {
  // "SafeMessage(bytes message)"
  SafeMessage: [{ type: "bytes", name: "message" }],
};

export const calculateSafeMessageHash = (
  safeAddress: string,
  message: string
): string => {
  // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
  const chainId = 31337;
  return ethers.TypedDataEncoder.hash(
    { verifyingContract: safeAddress, chainId },
    EIP712_SAFE_MESSAGE_TYPE,
    { message }
  );
};

export const buildContractSignature = (
  signerAddress: string,
  signature: string
): SafeSignature => {
  return {
    signer: signerAddress,
    data: signature,
    dynamic: true,
  };
};

export const signMessageAndValidate = async (
  signers: ViemWalletClient[],
  dataHash: `0x${string}`,
  safeAddress: `0x${string}`
) => {
  const validator = await hre.viem.getContractAt(
    "CompatibilityFallbackHandler",
    safeAddress
  );

  const domainData = {
    chainId: 31337,
    verifyingContract: validator.address,
  };

  const signatures = await Promise.all(
    signers.map(async (s) => {
      return {
        signer: s.account.address,
        data: await s.signTypedData({
          domain: domainData,
          types: EIP712_SAFE_MESSAGE_TYPE,
          primaryType: "SafeMessage",
          message: { message: dataHash },
        }),
      };
    })
  );

  const signature = buildSignatureBytes(signatures);
  /*
  const { result } = await (
    await hre.viem.getPublicClient()
  ).simulateContract({
    address: validator.address,
    abi: validator.abi,
    // @ts-ignore
    functionName: "isValidSignature",
    args: [dataHash, signature],
  });
  */

  //expect(result).to.be.eq("0x1626ba7e");

  return signature;
};
