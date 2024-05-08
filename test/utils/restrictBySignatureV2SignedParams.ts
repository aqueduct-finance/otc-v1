const restrictBySignatureV2SignedParams = {
  RestrictBySignatureV2SignedParams: [
    { name: "orderHash", type: "bytes32" },
    { name: "merkleRoot", type: "bytes32" },
    { name: "requireServerSignature", type: "uint256" }, // convert bool => uint256 for signature
    { name: "startTimestamp", type: "uint256" },
    { name: "endTimestamp", type: "uint256" },
  ],
};

export default restrictBySignatureV2SignedParams;
