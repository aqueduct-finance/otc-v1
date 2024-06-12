// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {ZoneInterface} from "seaport-types/src/interfaces/ZoneInterface.sol";
import {ZoneParameters, Schema} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ITokenLockupPlans} from "../misc/interfaces/ITokenLockupPlans.sol";
import {SpentItem, ReceivedItem} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {ItemType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {ITokenLockupPlansVerifier} from "./interfaces/ITokenLockupPlansVerifier.sol";

/**
 * @title TokenLockupPlansVerifier
 *
 * A zone contract for OpenSea's seaport protocol.
 * Allows seaport to verify locked token amounts in Hedgey's TokenLockupPlans contract.
 * With this, users can safely trade TokenLockupPlans lockups.
 * If tokens are redeemed from the lockup, the trade will be invalidated.
 */
contract TokenLockupPlansVerifier is ITokenLockupPlansVerifier {
    ITokenLockupPlans public immutable tokenLockupPlans;

    constructor(address _tokenLockupPlans) {
        tokenLockupPlans = ITokenLockupPlans(_tokenLockupPlans);
    }

    /**
     * @dev called by seaport after an order is settled
     * @notice only validates the first offer and/or consideration item
     *
     * @param zoneParameters the params passed from seaport
     */
    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external returns (bytes4 validOrderMagicValue) {
        // validate data first
        bytes32 zoneHash = keccak256(zoneParameters.extraData);
        if (zoneHash != zoneParameters.zoneHash) {
            revert INVALID_EXTRA_DATA();
        }

        // decode params
        LockupVerificationParams memory lockupParams = abi.decode(
            zoneParameters.extraData,
            (LockupVerificationParams)
        );

        // create time locks for each if specified
        if (lockupParams.considerationAmount > 0) {
            if (zoneParameters.consideration.length < 1) {
                revert NO_CONSIDERATION();
            }
            ReceivedItem memory consideration = zoneParameters.consideration[0];

            if (consideration.itemType != ItemType.ERC721) {
                revert CONSIDERATION_NOT_ERC721();
            }

            _checkLockup(
                zoneParameters.offerer,
                consideration.identifier,
                lockupParams.considerationAmount
            );
        }
        if (lockupParams.offerAmount > 0) {
            if (zoneParameters.offer.length < 1) {
                revert NO_OFFER();
            }
            SpentItem memory offer = zoneParameters.offer[0];

            if (offer.itemType != ItemType.ERC721) {
                revert OFFER_NOT_ERC721();
            }

            _checkLockup(
                zoneParameters.fulfiller,
                offer.identifier,
                lockupParams.offerAmount
            );
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    /**
     * @dev internal function to check lockup ownership and token amount
     *
     * @param owner the owner of the lockup
     * @param amount the amount expected to be locked
     */
    function _checkLockup(
        address owner,
        uint256 tokenId,
        uint256 amount
    ) internal {
        if (tokenLockupPlans.ownerOf(tokenId) != owner) {
            revert LOCKUP_INVALID_OWNER();
        }

        (, uint256 planAmount, , , , ) = tokenLockupPlans.plans(tokenId);
        if (planAmount != amount) {
            revert LOCKUP_INVALID_AMOUNT();
        }
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
