// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ZoneInterface} from "../lib/seaport-types/src/interfaces/ZoneInterface.sol";
import {IRequireServerSignature} from "./interfaces/IRequireServerSignature.sol";
import {ZoneParameters, Schema} from "../lib/seaport-types/src/lib/ConsiderationStructs.sol";
import {SeaportInterface} from "../lib/seaport-types/src/interfaces/SeaportInterface.sol";
import {OrderComponents} from "../lib/seaport-types/src/lib/ConsiderationStructs.sol";

/**
 * @notice RequireServerSignature allows a user to rely on a trusted intermediary to validate any arbitrary data offchain
 * 
 * A possible usecase:
 *  1. Alice signs an offer for Bob, but she doesn't know when Bob will fill the order
 *  2. Alice wants to ensure that Bob meets KYC/AML regulations at the time of trading, and she doesn't want to manage this herself
 *  3. A trusted KYC verifier deploys this contract, and sets their address as the owner
 *  3. Alice specifies this as the 'zone' when signing her seaport order
 *  4. When Bob is ready to fill the order, he completes the KYC verification, and the verifier provides him with a ServerToken
 *  5. Bob creates and fulfills an AdvancedOrder, where 'extraData' is the ServerToken
 */
contract RequireServerSignature is IRequireServerSignature {

    // constants
    string public constant _NAME = "RequireServerSignature";
    string public constant _VERSION = "1.0";

    // immutables
    bytes32 internal immutable _EIP_712_DOMAIN_TYPEHASH;
    bytes32 internal immutable _AUTH_PARAMS_TYPEHASH;
    bytes32 internal immutable _NAME_HASH;
    bytes32 internal immutable _VERSION_HASH;
    uint256 internal immutable _CHAIN_ID;
    bytes32 internal immutable _DOMAIN_SEPARATOR;

    // state
    address private owner;

    constructor(
        address _owner,
        uint256 _chainId
    ) {
        owner = _owner;
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
        _AUTH_PARAMS_TYPEHASH = keccak256(
            abi.encodePacked(
                "AuthParams(",
                "uint256 fulfiller,",
                "uint256 deadline",
                ")"
            )
        );
        _NAME_HASH = keccak256(bytes(_NAME));
        _VERSION_HASH = keccak256(bytes(_VERSION));
        _DOMAIN_SEPARATOR = _deriveDomainSeparator();
    }

    function setOwner(
        address _owner
    ) external {
        if (msg.sender != owner) { revert ONLY_OWNER(); }

        owner = _owner;
    }

    ///////////////////////////////////////////////////////////
    ///                                                     ///
    ///                Seaport Zone Interface               ///
    ///                                                     ///
    ///////////////////////////////////////////////////////////

    struct AuthParams {
        address fulfiller;
        uint256 deadline;
    }

    struct ServerToken {
        AuthParams authParams;
        bytes signature;
    }

    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external view returns (
        bytes4 validOrderMagicValue
    ) {
        // auth params and server signature encoded in zoneParameters.extraData
        ServerToken memory serverToken = abi.decode(zoneParameters.extraData, (ServerToken));

        // decode signature
        bytes32 r;
        bytes32 s;
        uint8 v;
        (r, s) = abi.decode(serverToken.signature, (bytes32, bytes32));
        v = uint8(serverToken.signature[64]);

        // check validity of server signature
        bytes32 domainSeparator = _domainSeparator();
        bytes32 authParamsHash = keccak256(abi.encodePacked(_AUTH_PARAMS_TYPEHASH, uint256(uint160(serverToken.authParams.fulfiller)), serverToken.authParams.deadline));
        bytes32 digest = keccak256(
            abi.encodePacked(uint16(0x1901), domainSeparator, authParamsHash)
        );
        address recoveredSigner = ecrecover(digest, v, r, s);
        if (recoveredSigner != owner) { revert INVALID_SERVER_SIGNATURE(); }

        // check auth params
        if (zoneParameters.fulfiller != serverToken.authParams.fulfiller) { revert INCORRECT_FULFILLER(); }
        if (block.timestamp > serverToken.authParams.deadline) { revert DEADLINE_EXCEEDED(); }

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