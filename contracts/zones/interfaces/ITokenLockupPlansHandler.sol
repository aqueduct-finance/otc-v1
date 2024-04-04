// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";

interface ITokenLockupPlansHandler is ZoneInterface {
    error INVALID_EXTRA_DATA();
    error NO_OFFER();
    error NO_CONSIDERATION();
    error OFFER_NOT_ERC20();
    error CONSIDERATION_NOT_ERC20();
    error CALLER_NOT_SEAPORT();

    struct CreatePlanParams {
        uint256 start;
        uint256 cliff;
        uint256 rate;
        uint256 period;
        bool initialized;
    }

    struct LockParams {
        CreatePlanParams offerLockupParams;
        CreatePlanParams considerationLockupParams;
    }
}
