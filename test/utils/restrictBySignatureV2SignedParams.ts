const restrictBySignatureV2SignedParams = {
  RestrictBySignatureV2SignedParams: [
    { name: "orderHash", type: "bytes32" },
    { name: "merkleRoot", type: "bytes32" },
    { name: "requireServerSignature", type: "uint256" }, // convert bool => uint256 for signature
  ],
};

export default restrictBySignatureV2SignedParams;
