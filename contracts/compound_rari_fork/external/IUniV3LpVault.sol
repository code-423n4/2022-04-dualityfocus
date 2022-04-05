pragma solidity ^0.5.16;

import "../ComptrollerInterface.sol";

/**
 * @title UniV3LpVault
 * @author Duality (h/t to Uniswap's UniswapV3Staker)
 */
interface IUniV3LpVault {
    /// @notice The comptroller that this contract is a vault for
    function comptroller() external view returns (ComptrollerInterface);

    /// @notice Returns the owner of a deposited NFT
    function ownerOf(uint256 tokenId) external view returns (address owner);

    function userTokens(address account, uint256 index) external view returns (uint256);

    /// @notice The max number of NFTs a user can deposit
    function userTokensMax() external view returns (uint256);

    /// @notice Withdraws a Uniswap V3 LP token `tokenId` from this contract to the recipient `to`
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param to The address where the LP token will be sent
    /// @param data An optional data array that will be passed along to the `to` address via the NFT safeTransferFrom
    function withdrawToken(
        uint256 tokenId,
        address to,
        bytes calldata data
    ) external;

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
}
