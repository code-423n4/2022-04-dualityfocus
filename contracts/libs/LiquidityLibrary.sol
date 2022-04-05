// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.7.6;

//interface
import "../external/uniswap/v3-core/interfaces/IUniswapV3Pool.sol";
import { SqrtPriceMathPartial } from "../external/opyn/SqrtPriceMathPartial.sol";

//lib
import "../external/uniswap/v3-core/libraries/FullMath.sol";
import "../external/uniswap/v3-core/libraries/TickMath.sol";
import "../external/uniswap/v3-periphery/libraries/PoolAddress.sol";

/// @title liquidity library
/// @notice provides functions to integrate with uniswap v3 oracle
/// @author Duality (main function by Opyn)
library LiquidityLibrary {
    /**
     * @notice get balances of token0 / token1 in a uniswap position
     * @dev knowing liquidity, tick range, and current tick gives balances
     *      Opyn team (https://github.com/opynfinance/squeeth-monorepo/blob/main/packages/hardhat/contracts/libs/VaultLib.sol)
     * @param _tickLower address of the uniswap position manager
     * @param _tickUpper uniswap position token id
     * @param _tick current price tick used for calculation
     * @return amount0 the amount of token0 in the uniswap position token
     * @return amount1 the amount of token1 in the uniswap position token
     */
    function _getToken0Token1Balances(
        int24 _tickLower,
        int24 _tickUpper,
        int24 _tick,
        uint128 _liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        // get the current price and tick from wPowerPerp pool
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(_tick);

        if (_tick < _tickLower) {
            amount0 = SqrtPriceMathPartial.getAmount0Delta(
                TickMath.getSqrtRatioAtTick(_tickLower),
                TickMath.getSqrtRatioAtTick(_tickUpper),
                _liquidity,
                true
            );
        } else if (_tick < _tickUpper) {
            amount0 = SqrtPriceMathPartial.getAmount0Delta(
                sqrtPriceX96,
                TickMath.getSqrtRatioAtTick(_tickUpper),
                _liquidity,
                true
            );
            amount1 = SqrtPriceMathPartial.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(_tickLower),
                sqrtPriceX96,
                _liquidity,
                true
            );
        } else {
            amount1 = SqrtPriceMathPartial.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(_tickLower),
                TickMath.getSqrtRatioAtTick(_tickUpper),
                _liquidity,
                true
            );
        }
    }

    function _getPoolAddress(
        address factory,
        address token0,
        address token1,
        uint24 fee
    ) internal pure returns (address) {
        PoolAddress.PoolKey memory poolKey = PoolAddress.getPoolKey(token0, token1, fee);
        return PoolAddress.computeAddress(factory, poolKey);
    }
}
