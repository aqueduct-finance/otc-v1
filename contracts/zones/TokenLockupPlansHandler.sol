// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {ZoneParameters, Schema} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ITokenLockupPlans} from "../misc/interfaces/ITokenLockupPlans.sol";
import {SpentItem, ReceivedItem} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ItemType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {SafeERC20} from "../tokens/utils/SafeERC20.sol";
import {IERC20} from "../tokens/interfaces/IERC20.sol";
import {ITokenLockupPlansHandler} from "./interfaces/ITokenLockupPlansHandler.sol";

/**
 * @title TokenLockupPlansHandler
 *
 * A zone contract for OpenSea's seaport protocol.
 * Atomically creates token lockups after settlement on seaport.
 * Uses Hedgey's TokenLockupPlansHandler contract for lockups.
 */
contract TokenLockupPlansHandler is ITokenLockupPlansHandler {
    ITokenLockupPlans public immutable tokenLockupPlans;
    address public immutable seaport;

    constructor(address _tokenLockupPlans, address _seaport) {
        tokenLockupPlans = ITokenLockupPlans(_tokenLockupPlans);
        seaport = _seaport;
    }

    /**
     * @dev called by seaport after an order is settled
     *
     * @param zoneParameters the params passed from seaport
     */
    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external returns (bytes4 validOrderMagicValue) {
        // only allowed to be called by seaport
        if (msg.sender != seaport) {
            revert CALLER_NOT_SEAPORT();
        }

        // validate data first
        bytes32 zoneHash = keccak256(zoneParameters.extraData);
        if (zoneHash != zoneParameters.zoneHash) {
            revert INVALID_EXTRA_DATA();
        }

        // decode params
        LockParams memory lockParams = abi.decode(
            zoneParameters.extraData,
            (LockParams)
        );

        // create time locks for each if specified
        if (lockParams.considerationLockupParams.initialized) {
            if (zoneParameters.consideration.length < 1) {
                revert NO_CONSIDERATION();
            }
            ReceivedItem memory consideration = zoneParameters.consideration[0];

            if (consideration.itemType != ItemType.ERC20) {
                revert CONSIDERATION_NOT_ERC20();
            }

            _createLockup(
                zoneParameters.offerer,
                consideration.token,
                consideration.amount,
                lockParams.considerationLockupParams
            );
        }
        if (lockParams.offerLockupParams.initialized) {
            if (zoneParameters.offer.length < 1) {
                revert NO_OFFER();
            }
            SpentItem memory offer = zoneParameters.offer[0];

            if (offer.itemType != ItemType.ERC20) {
                revert OFFER_NOT_ERC20();
            }

            _createLockup(
                zoneParameters.fulfiller,
                offer.token,
                offer.amount,
                lockParams.offerLockupParams
            );
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    /**
     * @dev internal function to transfer tokens from user and create lockup plan
     *
     * @param recipient the recipient of the lockup
     * @param token the token to transfer and lock
     * @param amount the amount to transfer and lock
     * @param createPlanParams the params defined by the user when they created the order
     */
    function _createLockup(
        address recipient,
        address token,
        uint256 amount,
        CreatePlanParams memory createPlanParams
    ) internal {
        // get tokens from user
        _transferTokens(
            IERC20(token),
            recipient,
            address(this),
            amount
        );

        // approve tokenLockupPlans contract to spend this token
        SafeERC20.forceApprove(
            IERC20(token),
            address(tokenLockupPlans),
            amount
        );
        
        // if user didn't specify start time, use block.timestamp
        if (createPlanParams.start == 0) {
            createPlanParams.start = block.timestamp;
        }

        // end offset should be greater than cliff offset
        if (createPlanParams.endOffsetTime < createPlanParams.cliffOffsetTime) {
            revert END_LESS_THAN_CLIFF();
        }

        // calculate rate
        uint256 rate = (amount * createPlanParams.period) /
            createPlanParams.endOffsetTime;

        // check for underflow
        if (rate == 0) {
            revert INVALID_RATE();
        }

        // create lockup
        tokenLockupPlans.createPlan(
            recipient,
            token,
            amount,
            createPlanParams.start,
            createPlanParams.start + createPlanParams.cliffOffsetTime,
            rate,
            createPlanParams.period
        );
    }

    /**
     * @dev internal function used for standard ERC20 transferFrom method
     * @notice it contains a pre and post balance check
     * @notice as well as a check on the msg.senders balance
     * 
     * @param token is the ERC20 being transferred
     * @param from is the remitting address
     * @param to is the location where they are being delivered
     */
    function _transferTokens(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        // check balance before transfer
        uint256 priorBalance = token.balanceOf(address(to));
        if (token.balanceOf(from) < amount) revert INSUFFICIENT_PRE_BALANCE();

        // make transfer and check balance after
        SafeERC20.safeTransferFrom(token, from, to, amount);
        uint256 postBalance = token.balanceOf(address(to));
        if (postBalance - priorBalance != amount) revert INSUFFICIENT_POST_BALANCE();
    }

    /**
     * @notice required by ZoneInterface, not necessary to implement
     */
    function getSeaportMetadata()
        external
        view
        returns (string memory name, Schema[] memory schemas)
    {}

    /**
     * @notice required by ZoneInterface, not necessary to implement
     */
    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}
