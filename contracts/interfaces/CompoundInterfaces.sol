// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma abicoder v2;

// Minimal Compound interfaces

interface InterestRateModel {
    function getBorrowRate(
        uint256 cash,
        uint256 borrows,
        uint256 reserves
    ) external view returns (uint256);

    function getSupplyRate(
        uint256 cash,
        uint256 borrows,
        uint256 reserves,
        uint256 reserveFactorMantissa
    ) external view returns (uint256);
}

interface CErc20Interface {
    /*** User Interface ***/

    function mintBehalf(address minter, uint256 mintAmount) external returns (uint256);

    function redeemBehalf(address redeemer, uint256 redeemTokens) external returns (uint256);

    function redeemUnderlyingBehalf(address redeemer, uint256 redeemAmount) external returns (uint256);

    function borrowBehalf(address borrower, uint256 borrowAmount) external returns (uint256);

    function repayBorrowBehalf(address borrower, uint256 repayAmount) external returns (uint256);

    function balanceOf(address owner) external view returns (uint256);

    function balanceOfUnderlying(address account) external returns (uint256);

    function exchangeRateCurrent() external returns (uint256);

    function getAccountSnapshot(address account)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        );

    function borrowBalanceCurrent(address account) external returns (uint256);

    function borrowBalanceStored(address account) external view returns (uint256);

    function underlying() external view returns (address);

    function liquidateBorrow(
        address borrower,
        uint256 repayAmount,
        CTokenInterface cTokenCollateral
    ) external returns (uint256);
}

interface CTokenInterface {
    /*** User Interface ***/
    function symbol() external view returns (string memory);

    function transfer(address dst, uint256 amount) external returns (bool);

    function transferFrom(
        address src,
        address dst,
        uint256 amount
    ) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function admin() external view returns (address);

    function allowance(address owner, address spender) external view returns (uint256);

    function balanceOf(address owner) external view returns (uint256);

    function balanceOfUnderlying(address owner) external returns (uint256);

    function getAccountSnapshot(address account)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        );

    function borrowRatePerBlock() external view returns (uint256);

    function supplyRatePerBlock() external view returns (uint256);

    function totalBorrowsCurrent() external returns (uint256);

    function reserveFactorMantissa() external view returns (uint256);

    function borrowBalanceCurrent(address account) external returns (uint256);

    function borrowBalanceStored(address account) external view returns (uint256);

    function underlying() external view returns (address);

    function exchangeRateCurrent() external returns (uint256);

    function exchangeRateStored() external view returns (uint256);

    function getCash() external view returns (uint256);

    function accrueInterest() external returns (uint256);

    function seize(
        address liquidator,
        address borrower,
        uint256 seizeTokens
    ) external returns (uint256);

    /*** Admin Functions ***/

    function _setPendingAdmin(address payable newPendingAdmin) external returns (uint256);

    function _acceptAdmin() external returns (uint256);

    function _setComptroller(ComptrollerInterface newComptroller) external returns (uint256);

    function _setReserveFactor(uint256 newReserveFactorMantissa) external returns (uint256);

    function _reduceReserves(uint256 reduceAmount) external returns (uint256);

    function _setInterestRateModel(InterestRateModel newInterestRateModel) external returns (uint256);
}

interface PriceOracleInterface {
    /**
     * @notice Get the underlying price of a cToken asset
     * @param cToken The cToken to get the underlying price of
     * @return The underlying asset price mantissa (scaled by 1e18).
     *  Zero means the price is unavailable.
     */
    function getUnderlyingPrice(CTokenInterface cToken) external view returns (uint256);

    /**
     * @notice Get the price of an underlying asset
     * @param underlying underlying to get the price of
     * @return The underlying asset price mantissa (scaled by 1e18).
     *  Zero means the price is unavailable.
     */
    function price(address underlying) external view returns (uint256);
}

interface TickOracleInterface {
    /**
     * @notice Get the current tick in the Uni V3 pool according to our oracle
     * @param pool the address of our uni v3 pool
     * @return the current tick
     */
    function getTick(address pool) external view returns (int24);

    /**
     * @notice Provides a breakdown of the current holdings of an NFT in both fees and liquidity, according to
     *          the TWAP tick
     * @param tokenId The tokenId that we are looking for a holdings breakdown of
     * @return token0 The first token of tokenId's pool
     *         token1 The second token of tokenId's pool
     *         amountToken0Fees Amount of token0 in fees
     *         amountToken1Fees Amount of token1 in fees
     *         amountToken0Liquidity Amount of token0 contributing to liquidity value
     *         amountToken1Liquidity Amount of token1 contributing to liquidity value
     *         amountLiquidity Amount of liquidity that tokenId represents
     */
    function getTokenBreakdownTWAP(uint256 tokenId)
        external
        view
        returns (
            address,
            address,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        );

    /**
     * @notice Provides a breakdown of the current holdings of an NFT in both fees and liquidity, according to
     *          the current instantaneous tick
     * @param tokenId the tokenId that we are looking for a holdings breakdown of
     * @return token0 The first token of tokenId's pool
     *         token1 The second token of tokenId's pool
     *         amountToken0Fees Amount of token0 in fees
     *         amountToken1Fees Amount of token1 in fees
     *         amountToken0Liquidity Amount of token0 contributing to liquidity value
     *         amountToken1Liquidity Amount of token1 contributing to liquidity value
     *         amountLiquidity Amount of liquidity that tokenId represents
     */
    function getTokenBreakdownCurrent(uint256 tokenId)
        external
        view
        returns (
            address,
            address,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        );
}

struct Market {
    bool isListed;
}

interface ComptrollerInterface {
    function admin() external view returns (address);

    function pauseGuardian() external view returns (address);

    function markets(address market) external view returns (Market memory);

    function cTokensByUnderlying(address underlying) external view returns (address);

    function oracle() external view returns (address);

    function tickOracle() external view returns (address);

    function getAccountLiquidity(address account)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        );

    /*** Assets You Are In ***/

    function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory);

    function exitMarket(address cToken) external returns (uint256);

    function getAssetsIn(address account) external view returns (address[] memory);

    function getAllMarkets() external view returns (CTokenInterface[] memory);

    /*** Policy Hooks ***/

    function mintAllowed(
        address cToken,
        address minter,
        uint256 mintAmount
    ) external returns (uint256);

    function mintWithinLimits(
        address cToken,
        uint256 exchangeRateMantissa,
        uint256 accountTokens,
        uint256 mintAmount
    ) external returns (uint256);

    function redeemAllowed(
        address cToken,
        address redeemer,
        uint256 redeemTokens
    ) external returns (uint256);

    function redeemVerify(
        address cToken,
        address redeemer,
        uint256 redeemAmount,
        uint256 redeemTokens
    ) external;

    function borrowAllowed(
        address cToken,
        address borrower,
        uint256 borrowAmount
    ) external returns (uint256);

    function borrowWithinLimits(address cToken, uint256 accountBorrowsNew) external returns (uint256);

    function repayBorrowAllowed(
        address cToken,
        address payer,
        address borrower,
        uint256 repayAmount
    ) external returns (uint256);

    function liquidateBorrowAllowed(
        address cTokenBorrowed,
        address cTokenCollateral,
        address liquidator,
        address borrower,
        uint256 repayAmount
    ) external returns (uint256);

    function seizeAllowed(
        address cTokenCollateral,
        address cTokenBorrowed,
        address liquidator,
        address borrower,
        uint256 seizeTokens
    ) external returns (uint256);

    function seizeAllowedUniV3(
        address lpVault,
        address cTokenBorrowed,
        address liquidator,
        address borrower,
        uint256 tokenId,
        uint256 seizeFeesToken0,
        uint256 seizeFeesToken1,
        uint256 seizeLiquidity
    ) external returns (uint256);

    function transferAllowed(
        address cToken,
        address src,
        address dst,
        uint256 transferTokens
    ) external returns (uint256);

    /*** Liquidity/Liquidation Calculations ***/

    function liquidateCalculateSeizeTokens(
        address cTokenBorrowed,
        address cTokenCollateral,
        uint256 repayAmount
    ) external view returns (uint256, uint256);

    function isSupportedPool(address poolAddress) external view returns (bool);

    function _beforeNonReentrant() external;

    function _afterNonReentrant() external;
}
