// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {OrderComponents} from "seaport-types/src/lib/ConsiderationStructs.sol";

interface IRequireServerSignature is ZoneInterface {
    error INVALID_SERVER_SIGNATURE();
    error ONLY_OWNER();
    error DEADLINE_EXCEEDED();
    error INCORRECT_FULFILLER();
    error INCORRECT_ORDER();

    function setOwner(address _owner) external;
}