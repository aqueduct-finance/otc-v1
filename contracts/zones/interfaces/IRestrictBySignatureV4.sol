// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface IRestrictBySignatureV4 is ZoneInterface {
    error ORDER_RESTRICTED();
    error INSUFFICIENT_MERKLE_PROOF();
    error MAX_FILL_EXCEEDED();
    error UNDER_MIN_FILL();
    error ONLY_OWNER();
    error DEADLINE_EXCEEDED();
    error END_TIME_EXCEEDED();
    error BEFORE_START_TIME();
    error CALLER_NOT_SEAPORT();

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

    struct RestrictBySignatureV4ServerToken {
        uint256 deadline;
        bytes signature;
    }

    struct RestrictBySignatureV4ExtraData {
        uint256 minFill;
        uint256 maxFill;
        uint256 startTimestamp;
        uint256 endTimestamp;
        RestrictBySignatureV4ServerToken serverToken;
    }
}
