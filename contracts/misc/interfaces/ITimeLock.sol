// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITimeLock {
    function createNFT(
        address _holder,
        uint256 _amount,
        address _token,
        uint256 _unlockDate
    ) external returns (uint256);
}