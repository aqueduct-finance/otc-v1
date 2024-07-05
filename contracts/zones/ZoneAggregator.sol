// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {IZoneAggregator} from "./interfaces/IZoneAggregator.sol";
import {ZoneParameters, Schema} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {SeaportInterface} from "seaport-types/src/interfaces/SeaportInterface.sol";
import {OrderComponents} from "seaport-types/src/lib/ConsiderationStructs.sol";

/**
 * @notice ZoneAggregator allows an arbitrary set of zones to be validated
 *
 * @dev
 * The user flow goes as follows:
 * 1. the offerer:
 *    a. constructs a list Z of type ZoneData[]:
 *       {
 *          address zoneAddress;
 *          bytes32 zoneHash;
 *       }
 *    b. computes the hash H of that list, excluding zoneData
 *    c. sets order.zoneHash to H
 *
 * 2. the fulfiller:
 *    a. constructs a list D of type bytes[]
 *    b. concatenates Z with D into ZD
 *    b. sets order.extraData to ZD
 *
 *
 *
 *
 *
 *
 * OLD:
 * 2. the fulfiller:
 *    a. constructs a list ZD from Z, of type ZoneData[]:
 *       {
 *          address zoneAddress;
 *          bytes32 zoneHash;
 *          bytes zoneData;
 *       }
 *    b. sets order.extraData to ZD
 *
 */
contract ZoneAggregator is IZoneAggregator {
    address public immutable seaport;

    constructor(address _seaport) {
        seaport = _seaport;
    }

    struct ZoneData {
        address zoneAddress;
        bytes32 zoneHash;
        bytes zoneExtraData;
    }

    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external returns (bytes4 validOrderMagicValue) {
        // only allowed to be called by seaport
        if (msg.sender != seaport) {
            revert CALLER_NOT_SEAPORT();
        }

        // decode extraData
        // this is a bit less efficient, but abi.decode doesn't seem to work with 'bytes' values outside of a struct
        ZoneData[] memory zones = abi.decode(
            zoneParameters.extraData,
            (ZoneData[])
        );

        // call validateOrder() on each zone
        // in this loop, we'll also pack the zone data to validate the zones later
        bytes memory packedData;
        uint256 len = zones.length;
        ZoneParameters memory modifiedParams = zoneParameters;
        for (uint i = 0; i < len; ) {
            // pack this zone's data
            packedData = abi.encodePacked(
                packedData,
                zones[i].zoneAddress,
                zones[i].zoneHash
            );

            // modify zoneParameters
            modifiedParams.zoneHash = zones[i].zoneHash;
            modifiedParams.extraData = zones[i].zoneExtraData;

            ZoneInterface(zones[i].zoneAddress).validateOrder(modifiedParams);

            unchecked {
                ++i;
            }
        }

        // validate the zones
        bytes32 zonesHash = keccak256(packedData);
        if (zonesHash != zoneParameters.zoneHash) {
            revert INVALID_ZONES();
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
