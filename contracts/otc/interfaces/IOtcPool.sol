// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

interface IOtcPool {
    struct Pool {
        address tokenA;
        address tokenB;
        uint256 saleAmount;
        uint256 thresholdAmount;
        uint256 deadline;
        uint256 minFillAmount;
        uint256 maxFillAmount;
        uint256 totalInvested;
        bool isActive;
        bool isCancelled;
    }

    struct Investment {
        uint256 poolId;
        uint256 amount;
    }

    error InvalidTokenAddresses();
    error InvalidAmounts();
    error InvalidDuration();
    error InvalidFillAmounts();
    error PoolUnavailableForInvestment();
    error PoolDeadlinePassed();
    error AmountBelowMinimumFill();
    error AmountAboveMaximumFill();
    error InvalidInvestmentAmount();
    error PoolUnavailableForActivation();
    error ThresholdNotReached();
    error PoolUnavailableForCancellation();
    error NotTokenOwner();
    error SaleNotActivated();
    error SaleIsActive();
    error CannotClaimYet();

    event PoolCreated(
        uint256 indexed poolId,
        address tokenA,
        address tokenB,
        uint256 saleAmount,
        uint256 thresholdAmount,
        uint256 deadline
    );
    event Invested(
        uint256 indexed poolId,
        address investor,
        uint256 amount,
        uint256 tokenId
    );
    event SaleActivated(uint256 indexed poolId);
    event SaleCancelled(uint256 indexed poolId);
    event TokensClaimed(
        uint256 indexed poolId,
        address claimer,
        uint256 amount
    );
    event InvestmentClaimed(
        uint256 indexed poolId,
        address claimer,
        uint256 amount
    );

    function createPool(
        address _tokenA,
        address _tokenB,
        uint256 _saleAmount,
        uint256 _thresholdAmount,
        uint256 _duration,
        uint256 _minFillAmount,
        uint256 _maxFillAmount
    ) external returns (uint256);

    function invest(uint256 _poolId, uint256 _amount) external;

    function activateSale(uint256 _poolId) external;

    function cancelSale(uint256 _poolId) external;

    function claimTokens(uint256 _tokenId) external;

    function claimInvestment(uint256 _tokenId) external;

    function pools(uint256 poolId) external view returns (Pool memory);

    function investments(
        uint256 tokenId
    ) external view returns (Investment memory);

    function poolTotalInvestments(
        uint256 poolId
    ) external view returns (uint256);
}
