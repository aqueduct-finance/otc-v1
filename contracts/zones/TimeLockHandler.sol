// SPDX-License-Identifier: BUSL-1.1
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
        if (lockParams.considerationUnlockDate != 0) {
            if (zoneParameters.consideration.length < 1) {
                revert NO_CONSIDERATION();
            }
            ReceivedItem memory consideration = zoneParameters.consideration[0];

            _createTimeLock(
                zoneParameters.offerer,
                consideration.token,
                consideration.amount,
                lockParams.considerationUnlockDate
            );
        }
        if (lockParams.offerUnlockDate != 0) {
            if (zoneParameters.offer.length < 1) {
                revert NO_OFFER();
            }
            SpentItem memory offer = zoneParameters.offer[0];

            _createTimeLock(
                zoneParameters.fulfiller,
                offer.token,
                offer.amount,
                lockParams.offerUnlockDate
            );
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    /**
     * @dev internal function to transfer tokens from user and create time lock
     *
     * @param recipient the recipient of the time lock, transfers tokens from them
     * @param token the token to transfer and lock
     * @param amount the amount to transfer and lock
     * @param unlockDate the timestamp that the position will be locked until
     */
    function _createTimeLock(
        address recipient,
        address token,
        uint256 amount,
        uint256 unlockDate
    ) internal {
        // get tokens from user
        SafeERC20.safeTransferFrom(
            IERC20(token),
            recipient,
            address(this),
            amount
        );

        // approve time lock contract to spend this token
        IERC20(token).approve(address(timeLock), amount);

        // create time lock
        timeLock.createNFT(recipient, amount, token, unlockDate);
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
