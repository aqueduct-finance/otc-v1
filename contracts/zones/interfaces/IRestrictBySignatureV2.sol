// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface IRestrictBySignatureV2 is ZoneInterface {
    error ORDER_RESTRICTED();
    error INSUFFICIENT_MERKLE_PROOF();
    error MAX_FILL_EXCEEDED();
    error UNDER_MIN_FILL();
    error ONLY_OWNER();
    error DEADLINE_EXCEEDED();
    error END_TIME_EXCEEDED();
    error BEFORE_START_TIME();

    /*
        Server token params:
        {
            bytes32 orderHash;
            address fulfiller;
            uint256 minFill;
            uint256 maxFill;
            uint256 deadline;
        }
    */

    struct RestrictBySignatureV2ServerToken {
        uint256 deadline;
        bytes signature;
    }

    struct RestrictBySignatureV2ExtraData {
        uint256 minFill;
        uint256 maxFill;
        bytes32[] nodes;
        bytes signature;
        bool requireServerSignature;
        uint256 startTimestamp;
        uint256 endTimestamp;
        RestrictBySignatureV2ServerToken serverToken;
    }

    struct RestrictBySignatureV2SignedParams {
        bytes32 orderHash;
        bytes32 merkleRoot;
        bool requireServerSignature;
        uint256 startTimestamp;
        uint256 endTimestamp;
    }
}
