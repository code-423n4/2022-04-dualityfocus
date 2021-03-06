pragma solidity ^0.5.16;

import "./CToken.sol";
import "./PriceOracle.sol";
import "./external/TickOracle.sol";
import "./external/IUniV3LpVault.sol";

contract UnitrollerAdminStorage {
    /**
     * @notice Administrator for this contract
     */
    address public admin;

    /**
     * @notice Pending administrator for this contract
     */
    address public pendingAdmin;

    /**
     * @notice Active brains of Unitroller
     */
    address public comptrollerImplementation;

    /**
     * @notice Pending brains of Unitroller
     */
    address public pendingComptrollerImplementation;
}

contract ComptrollerV1Storage is UnitrollerAdminStorage {
    /**
     * @notice Oracle which gives the price of any given asset
     */
    PriceOracle public oracle;



    /**
     * @notice Tick oracle which gives the current tick of a given Uni V3 Pool
     */
    TickOracle public tickOracle;

    /**
     * @notice Vault which holds and values user's Uni V3 LP Collateral
     */
    IUniV3LpVault public uniV3LpVault;
    /**
     * @notice Mapping of which pools are supported for Uni V3 LP Collateral
     */
    mapping(address => bool) public isSupportedPool;
    /**
     * @notice Mapping of pools to their collateralFactors in mantissa
     */
    mapping(address => uint256) public poolCollateralFactors;

    /**
     * @notice Multiplier used to calculate the maximum repayAmount when liquidating a borrow
     */
    uint256 public closeFactorMantissa;

    /**
     * @notice Multiplier representing the discount on collateral that a liquidator receives
     */
    uint256 public liquidationIncentiveMantissa;

    /**
     * @notice UNUSED AFTER UPGRADE: Max number of assets a single account can participate in (borrow or use as collateral)
     */
    uint256 internal maxAssets;

    /**
     * @notice Per-account mapping of "assets you are in", capped by maxAssets
     */
    mapping(address => CToken[]) public accountAssets;
}

contract ComptrollerV2Storage is ComptrollerV1Storage {
    struct Market {
        /**
         * @notice Whether or not this market is listed
         */
        bool isListed;
        /**
         * @notice Multiplier representing the most one can borrow against their collateral in this market.
         *  For instance, 0.9 to allow borrowing 90% of collateral value.
         *  Must be between 0 and 1, and stored as a mantissa.
         */
        uint256 collateralFactorMantissa;
        /**
         * @notice Per-market mapping of "accounts in this asset"
         */
        mapping(address => bool) accountMembership;
    }

    /**
     * @notice Official mapping of cTokens -> Market metadata
     * @dev Used e.g. to determine if a market is supported
     */
    mapping(address => Market) public markets;

    /// @notice A list of all markets
    CToken[] public allMarkets;

    /**
     * @dev Maps borrowers to booleans indicating if they have entered any markets
     */
    mapping(address => bool) internal borrowers;

    /// @notice A list of all borrowers who have entered markets
    address[] public allBorrowers;

    /// @notice Indexes of borrower account addresses in the `allBorrowers` array
    mapping(address => uint256) internal borrowerIndexes;

    /**
     * @dev Maps suppliers to booleans indicating if they have ever supplied to any markets
     */
    mapping(address => bool) public suppliers;

    /// @notice All cTokens addresses mapped by their underlying token addresses
    mapping(address => CToken) public cTokensByUnderlying;

    /**
     * @notice The Pause Guardian can pause certain actions as a safety mechanism.
     *  Actions which allow users to remove their own assets cannot be paused.
     *  Liquidation / seizing / transfer can only be paused globally, not by market.
     */
    address public pauseGuardian;
    bool public _mintGuardianPaused;
    bool public _borrowGuardianPaused;
    bool public transferGuardianPaused;
    bool public seizeGuardianPaused;
    mapping(address => bool) public mintGuardianPaused;
    mapping(address => bool) public borrowGuardianPaused;
}

contract ComptrollerV3Storage is ComptrollerV2Storage {
    /**
     * @dev Whether or not the implementation should be auto-upgraded.
     */
    bool public autoImplementation;

    /// @notice The borrowCapGuardian can set borrowCaps to any number for any market. Lowering the borrow cap could disable borrowing on the given market.
    address public borrowCapGuardian;

    /// @notice Borrow caps enforced by borrowAllowed for each cToken address. Defaults to zero which corresponds to unlimited borrowing.
    mapping(address => uint256) public borrowCaps;

    /// @notice Supply caps enforced by mintAllowed for each cToken address. Defaults to zero which corresponds to unlimited supplying.
    mapping(address => uint256) public supplyCaps;

    /// @dev Guard variable for pool-wide/cross-asset re-entrancy checks
    bool internal _notEntered;

    /// @dev Whether or not _notEntered has been initialized
    bool internal _notEnteredInitialized;
}
