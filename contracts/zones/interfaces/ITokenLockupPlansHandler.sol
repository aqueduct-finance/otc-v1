// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface ITokenLockupPlansHandler is ZoneInterface {
    error INVALID_EXTRA_DATA();
    error NO_OFFER();
    error NO_CONSIDERATION();
    error CALLER_NOT_SEAPORT();
}