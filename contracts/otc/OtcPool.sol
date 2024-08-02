// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IOtcPool.sol";

contract OtcPool is IOtcPool, ERC721, ReentrancyGuard {
    using Counters for Counters.Counter;

    Counters.Counter private _poolIds;
    Counters.Counter private _tokenIds;

    mapping(uint256 => Pool) private _pools;
    mapping(uint256 => Investment) private _investments;
    mapping(uint256 => uint256) public override poolTotalInvestments;

    constructor() ERC721("Aqueduct OTC Pool Position", "AOPP") {}

    /**
     * @dev returns the details of a specific pool
     * @param poolId the ID of the pool to query
     * @return pool struct containing all pool details
     */
    function pools(
        uint256 poolId
    ) external view override returns (Pool memory) {
        return _pools[poolId];
    }

    /**
     * @dev returns the details of a specific investment
     * @param tokenId the ID of the ERC721 token representing the investment
     * @return investment struct containing investment details
     */
    function investments(
        uint256 tokenId
    ) external view override returns (Investment memory) {
        return _investments[tokenId];
    }

    /**
     * @dev creates a new OTC pool for token exchange
     * @notice this function initializes a new pool with specified parameters
     * @param _tokenA the address of the token being sold
     * @param _tokenB the address of the token being bought
     * @param _saleAmount the amount of tokenA for sale
     * @param _thresholdAmount the minimum amount of tokenB to be raised
     * @param _duration the duration of the sale in seconds
     * @param _minFillAmount the minimum amount of tokenB that can be invested
     * @param _maxFillAmount the maximum amount of tokenB that can be invested
     * @return the ID of the newly created pool
     */
    function createPool(
        address _tokenA,
        address _tokenB,
        uint256 _saleAmount,
        uint256 _thresholdAmount,
        uint256 _duration,
        uint256 _minFillAmount,
        uint256 _maxFillAmount
    ) external override returns (uint256) {
        if (_tokenA == address(0) || _tokenB == address(0))
            revert InvalidTokenAddresses();
        if (_saleAmount == 0 || _thresholdAmount == 0) revert InvalidAmounts();
        if (_duration == 0) revert InvalidDuration();
        if (_minFillAmount == 0 || _maxFillAmount < _minFillAmount)
            revert InvalidFillAmounts();

        _poolIds.increment();
        uint256 newPoolId = _poolIds.current();

        _pools[newPoolId] = Pool({
            tokenA: _tokenA,
            tokenB: _tokenB,
            saleAmount: _saleAmount,
            thresholdAmount: _thresholdAmount,
            deadline: block.timestamp + _duration,
            minFillAmount: _minFillAmount,
            maxFillAmount: _maxFillAmount,
            totalInvested: 0,
            isActive: false,
            isCancelled: false
        });

        IERC20(_tokenA).transferFrom(msg.sender, address(this), _saleAmount);

        emit PoolCreated(
            newPoolId,
            _tokenA,
            _tokenB,
            _saleAmount,
            _thresholdAmount,
            block.timestamp + _duration
        );

        return newPoolId;
    }

    /**
     * @dev allows users to invest in an existing pool
     * @notice this function handles user investments in tokenB
     * @param _poolId the ID of the pool to invest in
     * @param _amount the amount of tokenB to invest
     */
    function invest(
        uint256 _poolId,
        uint256 _amount
    ) external override nonReentrant {
        Pool storage pool = _pools[_poolId];
        if (pool.isActive || pool.isCancelled)
            revert PoolUnavailableForInvestment();
        if (block.timestamp >= pool.deadline) revert PoolDeadlinePassed();
        if (_amount < pool.minFillAmount) revert AmountBelowMinimumFill();
        if (_amount > pool.maxFillAmount) revert AmountAboveMaximumFill();

        uint256 remainingAmount = pool.thresholdAmount - pool.totalInvested;
        uint256 investmentAmount = _amount > remainingAmount
            ? remainingAmount
            : _amount;

        if (investmentAmount == 0) revert InvalidInvestmentAmount();

        pool.totalInvested += investmentAmount;
        IERC20(pool.tokenB).transferFrom(
            msg.sender,
            address(this),
            investmentAmount
        );

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();
        _safeMint(msg.sender, newTokenId);

        _investments[newTokenId] = Investment({
            poolId: _poolId,
            amount: investmentAmount
        });

        emit Invested(_poolId, msg.sender, investmentAmount, newTokenId);
    }

    /**
     * @dev activates a sale when the threshold is met
     * @notice this function can only be called by the pool creator
     * @param _poolId the ID of the pool to activate
     */
    function activateSale(uint256 _poolId) external override nonReentrant {
        Pool storage pool = _pools[_poolId];
        if (pool.isActive || pool.isCancelled)
            revert PoolUnavailableForActivation();
        if (block.timestamp >= pool.deadline) revert PoolDeadlinePassed();
        if (pool.totalInvested < pool.thresholdAmount)
            revert ThresholdNotReached();

        pool.isActive = true;
        IERC20(pool.tokenB).transfer(msg.sender, pool.totalInvested);

        emit SaleActivated(_poolId);
    }

    /**
     * @dev cancels a sale before it's activated
     * @notice this function can only be called by the pool creator
     * @param _poolId the ID of the pool to cancel
     */
    function cancelSale(uint256 _poolId) external override nonReentrant {
        Pool storage pool = _pools[_poolId];
        if (pool.isActive || pool.isCancelled)
            revert PoolUnavailableForCancellation();

        pool.isCancelled = true;
        IERC20(pool.tokenA).transfer(msg.sender, pool.saleAmount);

        emit SaleCancelled(_poolId);
    }

    /**
     * @dev allows investors to claim their tokens after sale activation
     * @notice this function transfers the proportional amount of tokenA to the investor
     * @param _tokenId the ID of the ERC721 token representing the investment
     */
    function claimTokens(uint256 _tokenId) external override nonReentrant {
        Investment storage investment = _investments[_tokenId];
        Pool storage pool = _pools[investment.poolId];
        if (!_isApprovedOrOwner(msg.sender, _tokenId)) revert NotTokenOwner();
        if (!pool.isActive) revert SaleNotActivated();

        uint256 claimAmount = (investment.amount * pool.saleAmount) /
            pool.thresholdAmount;
        IERC20(pool.tokenA).transfer(msg.sender, claimAmount);

        _burn(_tokenId);
        delete _investments[_tokenId];

        emit TokensClaimed(investment.poolId, msg.sender, claimAmount);
    }

    /**
     * @dev allows investors to claim their investment back if sale is cancelled or deadline passed
     * @notice this function returns the original tokenB investment to the investor
     * @param _tokenId the ID of the ERC721 token representing the investment
     */
    function claimInvestment(uint256 _tokenId) external override nonReentrant {
        Investment storage investment = _investments[_tokenId];
        Pool storage pool = _pools[investment.poolId];
        if (!_isApprovedOrOwner(msg.sender, _tokenId)) revert NotTokenOwner();
        if (pool.isActive) revert SaleIsActive();
        if (!pool.isCancelled && block.timestamp <= pool.deadline)
            revert CannotClaimYet();

        IERC20(pool.tokenB).transfer(msg.sender, investment.amount);

        _burn(_tokenId);
        delete _investments[_tokenId];

        emit InvestmentClaimed(
            investment.poolId,
            msg.sender,
            investment.amount
        );
    }
}
