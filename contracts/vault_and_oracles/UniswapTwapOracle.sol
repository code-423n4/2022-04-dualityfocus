pragma solidity ^0.7.6;

// interfaces
import "../interfaces/IERC20Detailed.sol";
import { PriceOracleInterface, TickOracleInterface, CErc20Interface, CTokenInterface } from "../interfaces/CompoundInterfaces.sol";
import "../external/uniswap/v3-core/interfaces/IUniswapV3Pool.sol";

// libs
import { Uint256Casting } from "../external/opyn/Uint256Casting.sol";
import { SafeMath } from "../external/openzeppelin/math/SafeMath.sol";
import "../libs/UniswapTwapLibrary.sol";
import "../libs/LpBreakdownLibrary.sol";

/**
 * @title UniswapTwapOracle
 * @author Duality
 * @notice Oracle for TWAP prices according to Uniswap V3. Can also retreive TWAP Tick of a pool,
 *         and token balances given TWAP or instantenous tick & NFT position information
 * @dev Implements the `PriceOracle` interface used by Compound v2 and our `TickOracle` interface
 *      h/t to Fuse team
 */
contract UniswapTwapOracle is PriceOracleInterface, TickOracleInterface {
    using SafeMath for uint256;
    using Uint256Casting for uint256;

    uint128 private constant ONE = 1e18;

    /**
     * @dev WETH contract address.
     */
    address public immutable WETH_ADDRESS;

    /**
     * @dev nonfungiblePositionManager contract address.
     */
    address public immutable nfpManager;

    /**
     * @dev UniswapV3PoolFactory contract address.
     */
    address public immutable factory;

    /**
     * @dev The administrator of this `UniswapTwapPriceOracle`.
     */
    address public admin;

    /**
     * @dev Controls if `admin` can overwrite existing assignments of pools to underlying tokens.
     */
    bool public canAdminOverwrite;

    // period used to calculate our TWAPs, in TODO units
    uint32 public twapPeriod;

    // mapping from non-WEth address to uni v3 pool used for TWAP
    mapping(address => address) public referencePools;

    // mapping from uni v3 pool to bool of whether or not they are being utilized
    mapping(address => bool) public isSupportedPool;

    /**
     * @dev Constructor to initialize state variables.
     * @param _tokens The underlying ERC20 token addresses to link to `_pools`.
     * @param _pools The Uniswap V3 Pools to be assigned to `_tokens`.
     * @param _twapPeriod The period used to calculate our TWAP from the Uni V3 pool
     * @param _admin The admin who can assign pools to tokens.
     * @param _canAdminOverwrite Controls if `admin` can overwrite existing assignments of pools to tokens.
     */
    constructor(
        address[] memory _tokens,
        address[] memory _pools,
        uint32 _twapPeriod,
        address _wethAddress,
        address _nfpManager,
        address _factory,
        address _admin,
        bool _canAdminOverwrite
    ) {
        // Input validation
        require(
            _tokens.length > 0 && _tokens.length == _pools.length,
            "Lengths of both arrays must be equal and greater than 0."
        );

        // Initialize state variables
        for (uint256 i = 0; i < _tokens.length; i++) {
            require(_isWEthPool(_pools[i], _wethAddress), "for a pool to be added, it must contain the WETH asset");
            referencePools[_tokens[i]] = _pools[i];
            isSupportedPool[_pools[i]] = _pools[i] != address(0);
        }
        twapPeriod = _twapPeriod;
        WETH_ADDRESS = _wethAddress;
        nfpManager = _nfpManager;
        factory = _factory;
        admin = _admin;
        canAdminOverwrite = _canAdminOverwrite;
    }

    /**
     * @notice Get the LP token price for an underlying token address.
     * @param underlying The underlying token address for which to get the price (set to zero address for ETH)
     * @return Price denominated in ETH (scaled by 1e18)
     */
    function price(address underlying) external view override returns (uint256) {
        return _price(underlying);
    }

    /**
     * @notice Returns the price in ETH of the token underlying `cToken`.
     * @return Price in ETH of the token underlying `cToken`, scaled by `10 ** (36 - underlyingDecimals)`.
     */
    function getUnderlyingPrice(CTokenInterface cToken) external view override returns (uint256) {
        address underlying = CErc20Interface(address(cToken)).underlying();
        // Comptroller needs prices to be scaled by 1e(36 - decimals)
        // Since `_price` returns prices scaled by 18 decimals, we must scale them by 1e(36 - 18 - decimals)
        return (_price(underlying).mul(1e18)).div(10**uint256(IERC20Detailed(underlying).decimals()));
    }

    /**
     * @notice Returns the TWAP tick of the provided pool
     * @param pool the pool that we are retreiving the TWAP tick for
     * @return the TWAP tick of the pool, utilizing contract's twapPeriod
     */
    function getTick(address pool) external view override returns (int24) {
        return UniswapTwapLibrary.getTimeWeightedAverageTickSafe(pool, twapPeriod);
    }

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

    /**
     * @notice Fetches the TWAP token price in Eth from Uniswap, with 18 decimals of precision.
     * @param token the token for which we are retreiving the TWAP price
     * @return the TWAP price in ETH of the token from the referencePool
     */
    function _price(address token) internal view virtual returns (uint256) {
        require(referencePools[token] != address(0), "token must have reference pool");

        // isSupportedPool must return true or redundancy is broken
        assert(isSupportedPool[referencePools[token]]);

        return UniswapTwapLibrary.getTwap(referencePools[token], token, WETH_ADDRESS, twapPeriod, true);
    }

    function addAssets(address[] calldata tokens, address[] calldata pools) external onlyAdmin {
        // Input validation
        require(
            tokens.length > 0 && tokens.length == pools.length,
            "Lengths of both arrays must be equal and greater than 0."
        );

        // Assign oracles to underlying tokens
        for (uint256 i = 0; i < tokens.length; i++) {
            if (!canAdminOverwrite)
                require(
                    referencePools[tokens[i]] == address(0),
                    "Admin cannot overwrite existing assignments of pools to underlying tokens."
                );
            require(
                pools[i] == address(0) || _isWEthPool(pools[i], WETH_ADDRESS),
                "for a new pool to be added, it must contain the WETH asset"
            );
            // unsupport old pool
            isSupportedPool[referencePools[tokens[i]]] = false;
            referencePools[tokens[i]] = pools[i];
            isSupportedPool[pools[i]] = pools[i] != address(0);
        }
    }

    function _isWEthPool(address poolAddress, address wethAddress) internal view returns (bool) {
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);
        return pool.token0() == wethAddress || pool.token1() == wethAddress;
    }

    /**
     * @dev Modifier that checks if `msg.sender == admin`.
     */
    modifier onlyAdmin() {
        require(msg.sender == admin, "Sender is not the admin.");
        _;
    }
}
