// SPDX-License-Identifier: MIT
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
 * @notice TokenLockupPlansHandler
 */
contract TokenLockupPlansHandler is ITokenLockupPlansHandler {
    ITokenLockupPlans public immutable tokenLockupPlans;
    address public immutable seaport;

    constructor(address _tokenLockupPlans, address _seaport) {
        tokenLockupPlans = ITokenLockupPlans(_tokenLockupPlans);
        seaport = _seaport;
    }

    ///////////////////////////////////////////////////////////
    ///                                                     ///
    ///                Seaport Zone Interface               ///
    ///                                                     ///
    ///////////////////////////////////////////////////////////

    struct CreatePlanParams {
        uint256 start;
        uint256 cliff;
        uint256 rate;
        uint256 period;
    }

    struct LockParams {
        CreatePlanParams offerLockupParams;
        CreatePlanParams considerationLockupParams;
    }

    /**
     * @dev called by seaport after an order is settled
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
        if (lockParams.considerationLockupParams.start != 0) {
            if (zoneParameters.consideration.length < 1) {
                revert NO_CONSIDERATION();
            }
            ReceivedItem memory consideration = zoneParameters.consideration[0];

            _createLockup(
                zoneParameters.offerer,
                consideration.token,
                consideration.amount,
                lockParams.considerationLockupParams
            );
        }
        if (lockParams.offerLockupParams.start != 0) {
            if (zoneParameters.offer.length < 1) {
                revert NO_OFFER();
            }
            SpentItem memory offer = zoneParameters.offer[0];

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
     */
    function _createLockup(
        address recipient,
        address token,
        uint256 amount,
        CreatePlanParams memory createPlanParams
    ) internal {
        // get tokens from user
        SafeERC20.safeTransferFrom(
            IERC20(token),
            recipient,
            address(this),
            amount
        );

        // approve tokenLockupPlans contract to spend this token
        IERC20(token).approve(address(tokenLockupPlans), amount);

        // create lockup
        tokenLockupPlans.createPlan(
            recipient,
            token,
            amount,
            createPlanParams.start,
            createPlanParams.cliff,
            createPlanParams.rate,
            createPlanParams.period
        );
    }

    function getSeaportMetadata()
        external
        view
        returns (string memory name, Schema[] memory schemas)
    {}

    function supportsInterface(
        bytes4 //interfaceId
    ) external pure returns (bool) {
        return true;
    }
}
