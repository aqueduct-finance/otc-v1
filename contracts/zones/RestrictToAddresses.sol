// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {IRestrictToAddresses} from "./interfaces/IRestrictToAddresses.sol";
import {ZoneParameters, Schema} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {SeaportInterface} from "seaport-types/src/interfaces/SeaportInterface.sol";
import {OrderComponents} from "seaport-types/src/lib/ConsiderationStructs.sol";

/**
 * @notice RestrictToAddresses allows accounts to restrict their order to a given set of addresses, onchain
 * 
 * pros:
 *  - when constructing an order, the user only has to supply this zone address
 *  - consequently, the user can share the signed order with anyone, and add/remove restrictions after the fact (and without invalidating previous orders)
 *  - supports restriction to a set of 'unlimited' addresses
 * 
 * cons:
 *  - gas cost, requires onchain interactions
 *  - gas cost scales with number of restricted addresses
 *  TODO: allow reusing restriction sets across different orders
 *  TODO: improve privacy by storing address hashes
 */
contract RestrictToAddresses is IRestrictToAddresses {

    address public immutable seaport;

    // orderHash => (userAddress => isAllowed)
    mapping(bytes32 => mapping(address => bool)) public allowedAddresses;

    mapping(bytes32 => bool) public isOrderRestricted;

    constructor(
        address _seaport
    ) {
        seaport = _seaport;
    }

    function setAllowedAddresses(
        OrderComponents memory orderComponents,
        address[] memory addresses
    ) external {
        if (msg.sender != orderComponents.offerer) { revert MSG_SENDER_NOT_OFFERER(); }

        // get order hash (needs to be computed onchain for security)
        bytes32 orderHash = SeaportInterface(seaport).getOrderHash(orderComponents);

        // set isOrderRestricted
        isOrderRestricted[orderHash] = true;

        // set allowed addresses
        for (uint i = 0; i < addresses.length; i++) {
            allowedAddresses[orderHash][addresses[i]] = true;
        }
    }

    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external view returns (
        bytes4 validOrderMagicValue
    ) {
        if (allowedAddresses[zoneParameters.orderHash][zoneParameters.fulfiller] == false) {
            revert ORDER_RESTRICTED();
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    function getSeaportMetadata() external view returns (
        string memory name, 
        Schema[] memory schemas
    ) {}

    function supportsInterface(
        bytes4 //interfaceId
    ) external pure returns (
        bool
    ) {
        return true;
    }
}