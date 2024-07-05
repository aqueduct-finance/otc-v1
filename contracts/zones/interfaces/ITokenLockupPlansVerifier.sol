// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface ITokenLockupPlansVerifier is ZoneInterface {
    error LOCKUP_INVALID_AMOUNT();
    error LOCKUP_INVALID_OWNER();
    error INVALID_EXTRA_DATA();
    error LOCKUP_NOT_WHITELISTED();
    error CONSIDERATION_AMOUNT_NOT_SPECIFIED();
    error OFFER_AMOUNT_NOT_SPECIFIED();

    struct LockupVerificationParams {
        uint256[] offerAmounts;
        uint256[] considerationAmounts;
    }
}
