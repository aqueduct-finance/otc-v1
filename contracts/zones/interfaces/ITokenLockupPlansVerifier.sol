// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface ITokenLockupPlansVerifier is ZoneInterface {
    error NO_OFFER();
    error NO_CONSIDERATION();
    error OFFER_NOT_ERC721();
    error CONSIDERATION_NOT_ERC721();
    error LOCKUP_INVALID_AMOUNT();
    error LOCKUP_INVALID_OWNER();
}
