// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface IRestrictBySignatureV2 is ZoneInterface {
    error ORDER_RESTRICTED();
    error INSUFFICIENT_MERKLE_PROOF();
    error FILL_CAP_EXCEEDED();
    error ONLY_OWNER();
    error DEADLINE_EXCEEDED();

    /*
        Server token params:
        {
            bytes32 orderHash;
            address fulfiller;
            uint256 fillCap;
            uint256 deadline;
        }
    */

    struct RestrictBySignatureV2ServerToken {
        uint256 deadline;
        bytes signature;
    }

    struct RestrictBySignatureV2ExtraData {
        uint256 fillCap;
        bytes32[] nodes;
        bytes signature;
        bool requireServerSignature;
        RestrictBySignatureV2ServerToken serverToken;
    }

    struct RestrictBySignatureV2SignedParams {
        bytes32 orderHash;
        bytes32 merkleRoot;
        bool requireServerSignature;
    }
}
