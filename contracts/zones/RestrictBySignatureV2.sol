// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {IRestrictBySignatureV2} from "./interfaces/IRestrictBySignatureV2.sol";
import {ZoneParameters, Schema} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {SeaportInterface} from "seaport-types/src/interfaces/SeaportInterface.sol";
import {OrderComponents} from "seaport-types/src/lib/ConsiderationStructs.sol";

/**
 * @notice RestrictBySignatureV2 allows accounts to enforce order restrictions separately from their signed order
 * 
 * e.g:
 * - I create an order and specify this zone
 * - By default, no one can fill
 * - I can add permissions that associate with that order (identified by its hash)
 * - I can add new permissions after that without paying gas
 * - To revoke permissions, I either pay gas to revoke a signature, or use another safety mechanism like server signature
 * 
 * Compared to RestrictToAddressesBySignature, this contract:
 * 1. Does the same thing, but the offerer signs the merkle root instead of including that in the order
 * 2. Supports validation of other permissions (e.g. caps on fill amount per user)
 */
contract RestrictBySignatureV2 is IRestrictBySignatureV2 {

    // constants
    string public constant _NAME = "RestrictBySignatureV2";
    string public constant _VERSION = "1.0";

    // immutables
    bytes32 internal immutable _EIP_712_DOMAIN_TYPEHASH;
    bytes32 internal immutable _SIGNED_PARAMS_TYPEHASH;
    bytes32 internal immutable _NAME_HASH;
    bytes32 internal immutable _VERSION_HASH;
    uint256 internal immutable _CHAIN_ID;
    bytes32 internal immutable _DOMAIN_SEPARATOR;

    constructor(uint256 _chainId) {
        _CHAIN_ID = _chainId;

        // derive domain separator and cache values
        _EIP_712_DOMAIN_TYPEHASH = keccak256(
            abi.encodePacked(
                "EIP712Domain(",
                "string name,",
                "string version,",
                "uint256 chainId,",
                "address verifyingContract",
                ")"
            )
        );
        _SIGNED_PARAMS_TYPEHASH = keccak256(
            abi.encodePacked(
                "RestrictBySignatureV2SignedParams(",
                "bytes32 orderHash,",
                "bytes32 merkleRoot",
                ")"
            )
        );
        _NAME_HASH = keccak256(bytes(_NAME));
        _VERSION_HASH = keccak256(bytes(_VERSION));
        _DOMAIN_SEPARATOR = _deriveDomainSeparator();
    }

    ///////////////////////////////////////////////////////////
    ///                                                     ///
    ///                Seaport Zone Interface               ///
    ///                                                     ///
    ///////////////////////////////////////////////////////////

    /**
     * @param zoneParameters.zoneHash the merkle root, provided by the offerer
     * @param zoneParameters.extraData an array of nodes required to compute the merkle root, provided by the fulfiller
     */
    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external view returns (
        bytes4 validOrderMagicValue
    ) {
        RestrictBySignatureV2ExtraData memory decodedExtraData =  abi.decode(zoneParameters.extraData, (RestrictBySignatureV2ExtraData));
        bytes32 addressHash = keccak256(abi.encodePacked(zoneParameters.fulfiller, decodedExtraData.fillCap));
        bytes32 merkleRoot = computeMerkleRoot(addressHash, decodedExtraData.nodes);

        // decode signature
        bytes32 r;
        bytes32 s;
        uint8 v;
        (r, s) = abi.decode(decodedExtraData.signature, (bytes32, bytes32));
        v = uint8(decodedExtraData.signature[64]);

        // check validity of offerer's signature
        bytes32 domainSeparator = _domainSeparator();
        bytes32 authParamsHash = keccak256(abi.encodePacked(_SIGNED_PARAMS_TYPEHASH, zoneParameters.orderHash, merkleRoot));
        bytes32 digest = keccak256(
            abi.encodePacked(uint16(0x1901), domainSeparator, authParamsHash)
        );
        address recoveredSigner = ecrecover(digest, v, r, s);

        if (recoveredSigner != zoneParameters.offerer) {
            revert ORDER_RESTRICTED();
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    /**
     * @dev Hashes the values in the nodes array sequentially to obtain the merkle root
     * 
     * Each hash set will be sorted in ascending order before computing the parent
     */
    function computeMerkleRoot(
        bytes32 firstNode,
        bytes32[] memory nodes
    ) internal pure returns (
        bytes32 merkleRoot
    ) {
        // set first hash
        merkleRoot = firstNode;
        
        // compute root node with sequential hashes
        uint256 len = nodes.length; // cache length
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

    ///////////////////////////////////////////////////////////
    ///                                                     ///
    ///                   EIP-712 Helpers                   ///
    ///                                                     ///
    ///////////////////////////////////////////////////////////

    /**
     * @dev Internal view function to get the EIP-712 domain separator. If the
     *      chainId matches the chainId set on deployment, the cached domain
     *      separator will be returned; otherwise, it will be derived from
     *      scratch.
     * 
     * @notice taken from seaport
     */
    function _domainSeparator() internal view returns (bytes32) {
        return
            block.chainid == _CHAIN_ID
                ? _DOMAIN_SEPARATOR
                : _deriveDomainSeparator();
    }

    /**
     * @dev Internal view function to derive the EIP-712 domain separator.
     *
     * @notice taken from seaport
     * 
     * @return The derived domain separator.
     */
    function _deriveDomainSeparator() internal view virtual returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _EIP_712_DOMAIN_TYPEHASH,
                    _NAME_HASH,
                    _VERSION_HASH,
                    block.chainid,
                    address(this)
                )
            );
    }
}