pragma solidity ^0.7.6;

// interfaces
import "../interfaces/IERC20Detailed.sol";
import { TickOracleInterface } from "../interfaces/CompoundInterfaces.sol";
import "../external/uniswap/v3-core/interfaces/IUniswapV3Pool.sol";

// libs
import { Uint256Casting } from "../external/opyn/Uint256Casting.sol";
import { SafeMath } from "../external/openzeppelin/math/SafeMath.sol";
import "../libs/UniswapTwapLibrary.sol";
import "../libs/LpBreakdownLibrary.sol";

contract SimpleTickOracle is TickOracleInterface {
    address admin;
    address nfpManager;
    address factory;
    mapping(address => int24) ticks;
    event TickPosted(address pool, int24 previousTick, int24 newTick);

    constructor(address _nfpManager, address _factory) {
        admin = msg.sender;
        nfpManager = _nfpManager;
        factory = _factory;
    }

    function getTick(address pool) external view override returns (int24) {
        return ticks[pool];
    }

    function getTokenBreakdownTWAP(uint256 tokenId)
        external
        view
        override
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
        return LpBreakdownLibrary._getTokenBreakdown(tokenId, true, nfpManager, factory, address(this));
    }

    function getTokenBreakdownCurrent(uint256 tokenId)
        external
        view
        override
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
        return LpBreakdownLibrary._getTokenBreakdown(tokenId, false, nfpManager, factory, address(this));
    }

    function setTick(address pool, int24 tick) external {
        require(msg.sender == admin, "only admin may set pool tick");
        int24 oldTick = ticks[pool];
        ticks[pool] = tick;
        emit TickPosted(pool, oldTick, tick);
    }
}
