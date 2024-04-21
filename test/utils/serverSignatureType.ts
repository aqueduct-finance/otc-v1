const serverSignatureType = {
    AuthParams: [
      { name: "orderHash", type: "bytes32" },
      { name: "fulfiller", type: "uint256" }, // convert address => uint256 for signature
      { name: "deadline", type: "uint256" },
    ],
};

export default serverSignatureType;