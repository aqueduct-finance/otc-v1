// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {OrderComponents} from "seaport-types/src/lib/ConsiderationStructs.sol";

interface IRestrictToAddresses is ZoneInterface {
    error MSG_SENDER_NOT_OFFERER();
    error ORDER_RESTRICTED();

    function setAllowedAddresses(
        OrderComponents memory orderComponents,
        address[] memory addresses
    ) external;
}