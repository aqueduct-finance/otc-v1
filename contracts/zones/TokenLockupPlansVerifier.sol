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
    mapping(address => bool) public whitelistedLockupAddresses;

    constructor(address[] memory _whitelistedLockupAddresses) {
        for (uint256 i = 0; i < _whitelistedLockupAddresses.length; i++) {
            whitelistedLockupAddresses[_whitelistedLockupAddresses[i]] = true;
        }
    }

    /**
     * @dev called by seaport after an order is settled
     * @notice only validates the first offer and/or consideration item
     *
     * @param zoneParameters the params passed from seaport
     */
    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external view returns (bytes4 validOrderMagicValue) {
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

        // check all offer and consideration items for lockups
        // lockupParams.considerationAmounts and lockupParams.offerAmounts should be mapped 1:1 to items
        // e.g. even if the item is an ERC20, fill in that index with an arbitrary value like 0
        for (uint256 i = 0; i < zoneParameters.consideration.length; ++i) {
            ReceivedItem memory consideration = zoneParameters.consideration[i];

            if (consideration.itemType == ItemType.ERC721) {
                if (lockupParams.considerationAmounts.length < i || lockupParams.considerationAmounts[i] == 0) {
                    revert CONSIDERATION_AMOUNT_NOT_SPECIFIED();
                }

                _checkLockup(
                    zoneParameters.offerer,
                    consideration.identifier,
                    lockupParams.considerationAmounts[i],
                    ITokenLockupPlans(consideration.token)
                );
            }
        }
        for (uint256 i = 0; i < zoneParameters.offer.length; ++i) {
            SpentItem memory offer = zoneParameters.offer[i];

            if (offer.itemType == ItemType.ERC721) {
                if (lockupParams.offerAmounts.length < i || lockupParams.offerAmounts[i] == 0) {
                    revert OFFER_AMOUNT_NOT_SPECIFIED();
                }

                _checkLockup(
                    zoneParameters.fulfiller,
                    offer.identifier,
                    lockupParams.offerAmounts[i],
                    ITokenLockupPlans(offer.token)
                );
            }
        }

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    /**
     * @dev internal function to check lockup ownership and token amount
     *
     * @param owner the owner of the lockup
     * @param tokenId the token id of the lockup erc721
     * @param amount the amount expected to be locked
     * @param lockupContract the erc721 lockup contract
     */
    function _checkLockup(
        address owner,
        uint256 tokenId,
        uint256 amount,
        ITokenLockupPlans lockupContract
    ) internal view {
        if (!whitelistedLockupAddresses[address(lockupContract)]) {
            revert LOCKUP_NOT_WHITELISTED();
        }

        if (lockupContract.ownerOf(tokenId) != owner) {
            revert LOCKUP_INVALID_OWNER();
        }

        (, uint256 planAmount, , , , ) = lockupContract.plans(tokenId);
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
