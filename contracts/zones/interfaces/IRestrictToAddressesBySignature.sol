// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "../../lib/seaport-types/src/interfaces/ZoneInterface.sol";

interface IRestrictToAddressesBySignature is ZoneInterface {
    error ORDER_RESTRICTED();
    error INSUFFICIENT_MERKLE_PROOF();
}