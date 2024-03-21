// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {ZoneParameters, Schema} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ITimeLock} from "../misc/interfaces/ITimeLock.sol";
import {SpentItem, ReceivedItem} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ItemType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {SafeERC20} from "../tokens/utils/SafeERC20.sol";
import {IERC20} from "../tokens/interfaces/IERC20.sol";
import {ITimeLockHandler} from "./interfaces/ITimeLockHandler.sol";

/**
 * @notice TimeLockHandler
 */
contract TimeLockHandler is ITimeLockHandler {
    ITimeLock public immutable timeLock;
    address public immutable seaport;

    constructor(address _timeLock, address _seaport) {
        timeLock = ITimeLock(_timeLock);
        seaport = _seaport;
    }

    ///////////////////////////////////////////////////////////
    ///                                                     ///
    ///                Seaport Zone Interface               ///
    ///                                                     ///
    ///////////////////////////////////////////////////////////

    struct LockParams {
        uint256 offerUnlockDate;
        uint256 considerationUnlockDate;
    }

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
        if (lockParams.considerationUnlockDate != 0) {
            if (zoneParameters.consideration.length > 1) {
                revert NO_CONSIDERATION();
            }
            ReceivedItem memory consideration = zoneParameters.consideration[0];

            // get tokens from offerer
            SafeERC20.safeTransferFrom(
                IERC20(consideration.token),
                zoneParameters.offerer,
                address(this),
                consideration.amount
            );

            // approve time lock contract to spend this token
            IERC20(consideration.token).approve(
                address(timeLock),
                consideration.amount
            );

            timeLock.createNFT(
                zoneParameters.offerer,
                consideration.amount,
                consideration.token,
                lockParams.considerationUnlockDate
            );
        }
        if (lockParams.offerUnlockDate != 0) {
            if (zoneParameters.offer.length > 1) {
                revert NO_OFFER();
            }
            SpentItem memory offer = zoneParameters.offer[0];

            // get tokens from fulfiller
            SafeERC20.safeTransferFrom(
                IERC20(offer.token),
                zoneParameters.fulfiller,
                address(this),
                offer.amount
            );

            // approve time lock contract to spend this token
            IERC20(offer.token).approve(address(timeLock), offer.amount);

            timeLock.createNFT(
                zoneParameters.fulfiller,
                offer.amount,
                offer.token,
                lockParams.offerUnlockDate
            );
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
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
