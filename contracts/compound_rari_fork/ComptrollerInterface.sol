pragma solidity ^0.5.16;
import "./external/IUniV3LpVault.sol";

contract ComptrollerInterface {
    /// @notice Indicator that this is a Comptroller contract (for inspection)
    bool public constant isComptroller = true;

    IUniV3LpVault public uniV3LpVault;

    /*** Assets You Are In ***/

    function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory);

    function exitMarket(address cToken) external returns (uint256);

    /*** Policy Hooks ***/

    function mintAllowed(
        address cToken,
        address minter,
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

    function liquidateBorrowUniV3Allowed(
        address cTokenBorrowed,
        uint256 collateralTokenId,
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

    function getAccountLiquidity(address account)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        );

    function liquidateCalculateSeizeTokens(
        address cTokenBorrowed,
        address cTokenCollateral,
        uint256 repayAmount
    ) external view returns (uint256, uint256);

    function liquidateCalculateSeizeTokensUniV3(
        address cTokenBorrowed,
        uint256 collateralTokenId,
        uint256 actualRepayAmount
    )
        external
        view
        returns (
            uint256,
            uint128,
            uint128,
            uint128
        );

    /*** Pool-Wide/Cross-Asset Reentrancy Prevention ***/

    function _beforeNonReentrant() external;

    function _afterNonReentrant() external;
}
