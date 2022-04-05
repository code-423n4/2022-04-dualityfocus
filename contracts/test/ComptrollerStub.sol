pragma solidity ^0.7.6;

contract ComptrollerStub {
    struct Market {
        bool isListed;
    }

    mapping(address => Market) public markets;

    mapping(address => bool) public isSupportedPool;

    mapping(address => address) public cTokensByUnderlying;

    address public admin;

    address public pauseGuardian;

    address public oracle;

    address public tickOracle;

    bool public isLiquid;

    bool public seizeAllowed;

    bool public _notEntered;

    constructor() {
        admin = msg.sender;
        _notEntered = true;
    }

    function setIsSupportedPool(address pool, bool isSupported) external {
        isSupportedPool[pool] = isSupported;
    }

    function setMarket(address cToken, bool isListed) external {
        markets[cToken] = Market(isListed);
    }

    function setPauseGuardian(address addr) external {
        pauseGuardian = addr;
    }

    function setCTokenByUnderlying(address cToken, address underlying) external {
        cTokensByUnderlying[underlying] = cToken;
    }

    function setOracle(address newOracle) external {
        oracle = newOracle;
    }

    function setTickOracle(address newOracle) external {
        tickOracle = newOracle;
    }

    function setIsLiquid(bool newIsLiquid) external {
        isLiquid = newIsLiquid;
    }

    function setSeizeAllowed(bool newSeizeAllowed) external {
        seizeAllowed = newSeizeAllowed;
    }

    function getAccountLiquidity(address account)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        account;
        if (isLiquid) {
            return (0, 100, 0);
        } else {
            return (0, 0, 100);
        }
    }

    function seizeAllowedUniV3(
        address lpVault,
        address cTokenBorrowed,
        address liquidator,
        address borrower,
        uint256 tokenId,
        uint256 seizeFeesToken0,
        uint256 seizeFeesToken1,
        uint256 seizeLiquidity
    ) external view returns (uint256) {
        lpVault;
        cTokenBorrowed;
        liquidator;
        borrower;
        tokenId;
        seizeFeesToken0;
        seizeFeesToken1;
        seizeLiquidity;

        return seizeAllowed ? 0 : 1;
    }

    function _beforeNonReentrant() external {
        require(_notEntered, "re-entered across assets");
        _notEntered = false;
    }

    /**
     * @dev Called by cTokens after a non-reentrant function for pool-wide reentrancy prevention.
     * Prevents pool-wide/cross-asset reentrancy exploits like AMP on Cream.
     */
    function _afterNonReentrant() external {
        _notEntered = true; // get a gas-refund post-Istanbul
    }
}
