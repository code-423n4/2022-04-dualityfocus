pragma solidity ^0.7.6;
pragma abicoder v2;

import "../external/openzeppelin/token/ERC721/IERC721Receiver.sol";

import "../external/uniswap/v3-periphery/interfaces/INonfungiblePositionManager.sol";
import "../external/uniswap/v3-periphery/interfaces/ISwapRouter.sol";
import { ComptrollerInterface } from "./CompoundInterfaces.sol";
import { IFlashLoanReceiver } from "../external/aave/AaveInterfaces.sol";

/**
 * @title UniV3LpVault
 * @author Duality (h/t to Uniswap's UniswapV3Staker)
 */
interface IUniV3LpVault is IERC721Receiver {
    /// @notice Emitted when a user deposits a supported Uni V3 LP Token
    event TokenDeposited(address account, uint256 tokenId);

    /// @notice Emitted when a token is withdrawn by a user
    event TokenWithdrawn(address account, address to, uint256 tokenId);

    /// @notice Emitted when a decreaseLiquidity call has been completed successfully
    event LiquidityDecreased(address account, uint256 tokenId, uint128 liquidity);

    /// @notice Emitted when a collectFee call has been completed successfully
    event FeesCollected(address account, uint256 tokenId, uint256 amount0, uint256 amount1);

    /// @notice Emitted when a compoundFees call has been completed successfully
    event FeesCompounded(
        address account,
        uint256 tokenId,
        uint256 amountDeposited0,
        uint256 amountDeposited1,
        uint256 amountReturned0,
        uint256 amountReturned1
    );

    /// @notice Emitted when a moveRange call has been completed successfully
    event RangeMoved(address account, uint256 oldTokenId, uint256 newTokenId, uint128 liquidityMoved, bool burned);

    /// @notice Emitted when a FlashFocus call has been completed successfully
    event FlashFocus(
        address account,
        uint256 tokenId,
        address debtAsset,
        uint256 debtAmount,
        uint256 amountDeposited0,
        uint256 amountDeposited1,
        uint256 amountReturned0,
        uint256 amountReturned1
    );

    /// @notice Emitted when a RepayDebt call has been completed successfully
    event RepayDebt(
        address account,
        uint256 tokenId,
        uint128 liquidity,
        address debtCToken,
        address underlying,
        uint256 repayAmount,
        uint256 amountReturned
    );

    /// @notice Emitted when a new flashLoanContract is set
    event NewFlashLoanContract(address oldFlashLoanContract, address newFlashLoanContract);

    /// @notice Emitted when a new userTokensMax is set
    event NewUserTokensMax(uint256 oldUserTokenMax, uint256 newUserTokenMax);

    /// @notice Emitted when an action is paused globally
    event ActionPaused(string action, bool pauseState);

    /// @notice The Uniswap V3 Factory
    function factory() external view returns (address);

    /// @notice The nonfungible position manager address with which this staking contract is compatible
    function nonfungiblePositionManager() external view returns (INonfungiblePositionManager);

    /// @notice The nonfungible position manager address with which this staking contract is compatible
    function swapRouter() external view returns (ISwapRouter);

    /// @notice The comptroller that this contract is a vault for
    function comptroller() external view returns (ComptrollerInterface);

    function flashLoan() external view returns (IFlashLoanReceiver);

    function flashLoanAuthorized(address user) external view returns (bool);

    /// @notice Returns the owner of the deposited NFT
    function ownerOf(uint256 tokenId) external view returns (address owner);

    /// @notice The max number of NFTs a user can deposit
    function userTokensMax() external view returns (uint256);

    /// @notice Withdraws a Uniswap V3 LP token `tokenId` from this contract to the recipient `to`
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param to The address where the LP token will be sent
    /// @param data An optional data array that will be passed along to the `to` address via the NFT safeTransferFrom
    function withdrawToken(
        uint256 tokenId,
        address to,
        bytes memory data
    ) external;

    // do we want a "decreaseLiquidityAndCollect" function? to avoid calling authorization / avoidShortfall funcs twice in multicall
    function decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams calldata params) external;

    function collectFees(INonfungiblePositionManager.CollectParams calldata params) external;

    struct CompoundFeesParams {
        uint256 tokenId;
        uint256 expectedAmount0; // expected amount of token0 that we will deposit
        uint256 expectedAmount1; // expected amount of token1 that we will deposit
        uint256 amount0Min; // min amount of token0 deposited into range (price check)
        uint256 amount1Min; // min amount of token1 deposited into range (price check)
    }

    // automatically compound fees back into range
    function compoundFees(CompoundFeesParams calldata params) external;

    struct MoveRangeParams {
        uint256 tokenId;
        uint128 liquidity; // can move partial liquidity
        int24 newTickLower;
        int24 newTickUpper;
        uint256 expectedAmount0; // expected amount of token0 that we will deposit
        uint256 expectedAmount1; // expected amount of token1 that we will deposit
        uint256 amount0Min; // min amount of token0 deposited into range (price check)
        uint256 amount1Min; // min amount of token1 deposited into range (price check)
    }

    function moveRange(MoveRangeParams calldata params) external returns (uint256 newTokenId);

    struct FlashFocusParams {
        uint256 tokenId;
        address asset;
        uint256 amount;
        uint256 premium; // ignored from user side
        uint256 expectedAmount0;
        uint256 expectedAmount1;
        uint256 amount0Min;
        uint256 amount1Min;
        bytes swapPath;
    }

    function flashFocus(FlashFocusParams calldata params) external;

    function flashFocusCall(FlashFocusParams calldata params) external;

    struct RepayDebtParams {
        uint256 tokenId;
        uint128 liquidity; // can move partial liquidity
        uint256 repayAmount;
        address debtCToken;
        address underlying;
        bytes swapPath0; // path to swap
        bytes swapPath1;
    }

    function repayDebt(RepayDebtParams calldata params) external returns (uint256 amountRemaining);

    function getUserTokensLength(address account) external view returns (uint256 length);

    function getPoolAddress(uint256 tokenId) external view returns (address);

    function seizeAssets(
        address liquidator,
        address borrower,
        uint256 tokenId,
        uint256 seizeFeesToken0,
        uint256 seizeFeesToken1,
        uint256 seizeLiquidity
    ) external;

    function _pauseDeposits(bool state) external returns (bool);

    function _pausePeripheryFunctions(bool state) external returns (bool);

    function _setFlashLoan(address _flashLoan) external returns (address);

    /**
     * @notice set new userTokensMax as a contract admin
     * @param _userTokensMax the new value for userTokensMax
     */
    function _setUserTokensMax(uint256 _userTokensMax) external returns (uint256);

    function _sweep(
        address token,
        address to,
        uint256 amount
    ) external;

    function _sweepNFT(
        address nftContract,
        address to,
        uint256 tokenId
    ) external;
}
