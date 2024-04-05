// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface IZoneAggregator is ZoneInterface {
    error INVALID_ZONES();
    error CALLER_NOT_SEAPORT();
}
