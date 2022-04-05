pragma solidity ^0.5.16;

contract TickOracle {
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
