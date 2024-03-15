// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {ZoneParameters, Schema} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ITimeLock} from "../misc/interfaces/ITimeLock.sol";
import {SpentItem, ReceivedItem} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ItemType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {SafeERC20} from "../tokens/utils/SafeERC20.sol";
import {IERC20} from "../tokens/interfaces/IERC20.sol";

/**
 * @notice TimeLockHandler
 */
contract TimeLockHandler {
    ITimeLock public immutable timeLock;

    constructor(address _timeLock) {
        timeLock = ITimeLock(_timeLock);
    }

    ///////////////////////////////////////////////////////////
    ///                                                     ///
    ///                Seaport Zone Interface               ///
    ///                                                     ///
    ///////////////////////////////////////////////////////////

    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external returns (bytes4 validOrderMagicValue) {
        SpentItem memory offer = zoneParameters.offer[0];
        ReceivedItem memory consideration = zoneParameters.consideration[0];
        address offerer = zoneParameters.offerer;
        address fulfiller = zoneParameters.fulfiller;

        // get tokens from offerer and fulfiller
        SafeERC20.safeTransferFrom(
            IERC20(consideration.token),
            offerer,
            address(this),
            consideration.amount
        );
        SafeERC20.safeTransferFrom(
            IERC20(offer.token),
            fulfiller,
            address(this),
            offer.amount
        );

        // approve time lock contract to spend each token
        // ideally save gas by approving max amount in constructor,
        // but we don't know the tokens until the trade happens
        IERC20(offer.token).approve(address(timeLock), offer.amount);
        IERC20(consideration.token).approve(
            address(timeLock),
            consideration.amount
        );

        // create time locks for each
        timeLock.createNFT(
            offerer,
            offer.amount,
            offer.token,
            block.timestamp + 1000 // TODO: pass in as param
        );
        timeLock.createNFT(
            fulfiller,
            consideration.amount,
            consideration.token,
            block.timestamp + 1000
        );

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
