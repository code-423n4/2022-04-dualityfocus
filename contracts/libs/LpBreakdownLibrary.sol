pragma solidity ^0.7.6;

import "../interfaces/IERC20Detailed.sol";
import "../interfaces/ITickOracle.sol";
import "./LiquidityLibrary.sol";

import "./TicksLibrary.sol";
import "../external/uniswap/v3-core/interfaces/IUniswapV3Pool.sol";
import "../external/uniswap/v3-core/libraries/FixedPoint128.sol";
import "../external/uniswap/v3-core/libraries/FullMath.sol";
import "../external/uniswap/v3-periphery/interfaces/INonfungiblePositionManager.sol";

import { SafeMath } from "../external/openzeppelin/math/SafeMath.sol";

library LpBreakdownLibrary {
    using SafeMath for uint256;

    struct TokenValueLocalVars {
        address poolAddress;
        address token0;
        address token1;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 oldFeeGrowthInside0LastX128;
        uint256 oldFeeGrowthInside1LastX128;
        uint256 tokensOwed0;
        uint256 tokensOwed1;
    }

    /**
     * @dev gets the breakdown of a LP Token in the pool's underlying tokens, utilizing an instantaneous or TWAP tick
     * @param tokenId The tokenId to get a breakdown of
     * @param isTwap Whether to use a TWAP or instantaneous tick for calculations
     * @return token0 The first token of tokenId's pool
     *         token1 The second token of tokenId's pool
     *         amountToken0Fees Amount of token0 in fees
     *         amountToken1Fees Amount of token1 in fees
     *         amountToken0Liquidity Amount of token0 contributing to liquidity value
     *         amountToken1Liquidity Amount of token1 contributing to liquidity value
     *         amountLiquidity Amount of liquidity that tokenId represents
     */
    function _getTokenBreakdown(
        uint256 tokenId,
        bool isTwap,
        address nfpManager,
        address factory,
        address tickOracle
    )
        internal
        view
        returns (
            address token0,
            address token1,
            uint256 amountToken0Fees,
            uint256 amountToken1Fees,
            uint256 amountToken0Liquidity,
            uint256 amountToken1Liquidity,
            uint256 amountLiquidity
        )
    {
        TokenValueLocalVars memory vars = _generateTokenValueLocalVars(tokenId, nfpManager, factory);
        token0 = vars.token0;
        token1 = vars.token1;
        amountLiquidity = uint256(vars.liquidity);

        (, int24 currentTick, , , , , ) = IUniswapV3Pool(vars.poolAddress).slot0();

        (amountToken0Fees, amountToken1Fees) = _getTokensOwed(vars, currentTick);

        int24 tick;

        if (isTwap) tick = ITickOracle(tickOracle).getTick(vars.poolAddress);
        else tick = currentTick;

        (amountToken0Liquidity, amountToken1Liquidity) = LiquidityLibrary._getToken0Token1Balances(
            vars.tickLower,
            vars.tickUpper,
            tick,
            vars.liquidity
        );
    }

    /**
     * @dev generates an in-memory struct of position information of the tokenId to be used for computations
     * @param tokenId The tokenId to generate position information of
     * @return vars The in-memory struct containing all most recently updated information about our tokenId
     */
    function _generateTokenValueLocalVars(
        uint256 tokenId,
        address nfpmManager,
        address factory
    ) internal view returns (TokenValueLocalVars memory vars) {
        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 oldFeeGrowthInside0LastX128,
            uint256 oldFeeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = INonfungiblePositionManager(nfpmManager).positions(tokenId);

        vars.token0 = token0;
        vars.token1 = token1;
        vars.oldFeeGrowthInside0LastX128 = oldFeeGrowthInside0LastX128;
        vars.oldFeeGrowthInside1LastX128 = oldFeeGrowthInside1LastX128;
        vars.tickLower = tickLower;
        vars.tickUpper = tickUpper;
        vars.liquidity = liquidity;
        vars.tokensOwed0 = uint256(tokensOwed0);
        vars.tokensOwed1 = uint256(tokensOwed1);
        vars.poolAddress = LiquidityLibrary._getPoolAddress(factory, token0, token1, fee);
    }

    /**
     * @dev calculates updated fees for a tokenId position given old stats
     * @param vars The in-memory struct containing all most recently updated information about our tokenId
     * @return tokensOwed0 The updated amount of token0 collected in fees
     *         tokensOwed1 The updated amount of token1 collected in fees
     */
    function _getTokensOwed(TokenValueLocalVars memory vars, int24 tick)
        internal
        view
        returns (uint256 tokensOwed0, uint256 tokensOwed1)
    {
        (uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128) = TicksLibrary.getFeeGrowthInside(
            vars.poolAddress,
            vars.tickLower,
            vars.tickUpper,
            tick,
            IUniswapV3Pool(vars.poolAddress).feeGrowthGlobal0X128(),
            IUniswapV3Pool(vars.poolAddress).feeGrowthGlobal1X128()
        );

        tokensOwed0 = vars.tokensOwed0.add(
            FullMath.mulDiv(
                feeGrowthInside0LastX128 - vars.oldFeeGrowthInside0LastX128,
                vars.liquidity,
                FixedPoint128.Q128
            )
        );

        tokensOwed1 = vars.tokensOwed1.add(
            FullMath.mulDiv(
                feeGrowthInside1LastX128 - vars.oldFeeGrowthInside1LastX128,
                vars.liquidity,
                FixedPoint128.Q128
            )
        );
    }
}
