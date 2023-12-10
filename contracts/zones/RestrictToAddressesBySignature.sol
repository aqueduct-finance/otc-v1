// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "../lib/seaport-types/src/interfaces/ZoneInterface.sol";
import {IRestrictToAddressesBySignature} from "./interfaces/IRestrictToAddressesBySignature.sol";
import {ZoneParameters, Schema} from "../lib/seaport-types/src/lib/ConsiderationStructs.sol";
import {SeaportInterface} from "../lib/seaport-types/src/interfaces/SeaportInterface.sol";
import {OrderComponents} from "../lib/seaport-types/src/lib/ConsiderationStructs.sol";

/*
    @notice RestrictToAddressesBySignature allows accounts to restrict their order to a given set of addresses, via their signed order
    
    @dev
    This zone contract uses merkle trees to valide that the fulfiller belongs to an arbitrary resitricted set of addresses
    The offchain flow goes as follows:
    1. the offerer creates some arbitrary set S, that representes the addresses that are allowed to fulfill the trade
    2. the offerer computes the root node of the merkle tree where each leaf node is from S
    3. the offerer supplies the value of the root node as the 'zoneHash' in their order
    4. the offerer shares the merkle tree with each possible fulfiller
    5. the fulfiller can find their leaf node by computing the hash of their address
    6. a fulfiller will create an AdvancedOrder, where 'extraData' is an array of each node required to compute the merkle root
    - when the order is fulfilled, this zone contract will compute the merkle root based on the fulfiller's address, and the 'extraData' they provide
    - if this value is equal to the order's 'zoneHash', the order is valid

    pros:
    - gasless/offchain order restrictions
    - private set of restricted addresses 

    cons:
    - if the user wishes to change the restriction set after sharing the signed order, they will need to re-sign the order and invalidate the previous one
    - for example, with a partial fill order, it could be tedious to compute the amount remaining and reconstruct the order every time the restriction set changes
    - time complexity at fulfillment is non-constant, but very efficient: computing the merkle root is O(log_2(n))
        - e.g. if the resitricted set is extremely large, it would make more sense to sign orders separately for each fulfiller, but this would not work well for partial fills
*/
contract RestrictToAddressesBySignature is IRestrictToAddressesBySignature {

    /*
        @param zoneParameters.zoneHash the merkle root, provided by the offerer
        @param zoneParameters.extraData an array of nodes required to compute the merkle root, provided by the fulfiller
    */
    error bla(uint256 a);
    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external view returns (
        bytes4 validOrderMagicValue
    ) {
        bytes32[] memory nodes = abi.decode(zoneParameters.extraData, (bytes32[]));
        bytes32 addressHash = keccak256(abi.encodePacked(zoneParameters.fulfiller));
        bytes32 merkleRoot = computeMerkleRoot(addressHash, nodes);

        if (zoneParameters.zoneHash != merkleRoot) {
            revert ORDER_RESTRICTED();
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    /*
        @dev Hashes the values in the nodes array sequentially to obtain the merkle root

        Each hash set will be sorted in ascending order before computing the parent
    */
    function computeMerkleRoot(
        bytes32 firstNode,
        bytes32[] memory nodes
    ) internal pure returns (
        bytes32 merkleRoot
    ) {
        uint256 len = nodes.length; // cache length
        if (len < 1) { revert INSUFFICIENT_MERKLE_PROOF(); }

        // set first hash
        merkleRoot = firstNode;
        
        // compute root node with sequential hashes
        for (uint i = 0; i < len;) {
            bytes32 nextNode = nodes[i];
            if (merkleRoot < nextNode) {
                merkleRoot = keccak256(abi.encodePacked(merkleRoot, nextNode));
            } else {
                merkleRoot = keccak256(abi.encodePacked(nextNode, merkleRoot));
            }

            unchecked {
                ++i;
            }
        }
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