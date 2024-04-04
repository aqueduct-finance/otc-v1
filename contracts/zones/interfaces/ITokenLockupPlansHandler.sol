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
    error END_LESS_THAN_CLIFF();
    error INVALID_RATE();

    /**
     * @param start when the vesting plan starts, a unix timestamp
     * @param cliffOffsetTime number of seconds after start, when the cliff begins
     * @param endOffsetTime number of seconds after start, when the plan is fully vested
     * @param period how frequently tokens will vest after the cliff (e.g. 100 = every 100 seconds)
     */
    struct CreatePlanParams {
        uint256 start;
        uint256 cliffOffsetTime;
        uint256 endOffsetTime;
        uint256 period;
        bool initialized;
    }

    struct LockParams {
        CreatePlanParams offerLockupParams;
        CreatePlanParams considerationLockupParams;
    }
}
