const serverSignatureTypeV2 = {
  RestrictBySignatureV2AuthParams: [
    { name: "orderHash", type: "bytes32" },
    { name: "fulfiller", type: "uint256" }, // convert address => uint256 for signature
    { name: "minFill", type: "uint256" },
    { name: "maxFill", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export default serverSignatureTypeV2;
