// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface IRestrictBySignatureV2 is ZoneInterface {
    error ORDER_RESTRICTED();
    error INSUFFICIENT_MERKLE_PROOF();

    struct RestrictBySignatureV2ExtraData {
        uint256 fillCap;
        bytes32[] nodes;
        bytes signature;
    }

    struct RestrictBySignatureV2SignedParams {
        bytes32 orderHash;
        bytes32 merkleRoot;
    }
}
