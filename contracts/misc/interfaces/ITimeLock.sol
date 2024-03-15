// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITimeLock {
    function createNFT(
        address _holder,
        uint256 _amount,
        address _token,
        uint256 _unlockDate
    ) external returns (uint256);

    function redeemNFT(uint256 _id) external returns (bool);

    function tokenOfOwnerByIndex(
        address owner,
        uint256 index
    ) external view returns (uint256);
}
