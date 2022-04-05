pragma solidity ^0.7.6;
pragma abicoder v2;

// interfaces
import { ComptrollerInterface, TickOracleInterface, CErc20Interface } from "../interfaces/CompoundInterfaces.sol";
import "../interfaces/IUniV3LpVault.sol";
import "../interfaces/IERC20Detailed.sol";
import { IFlashLoanReceiver } from "../external/aave/AaveInterfaces.sol";
import "../external/openzeppelin/token/ERC721/IERC721.sol";
import "../external/uniswap/v3-periphery/interfaces/INonfungiblePositionManager.sol";
import "../external/uniswap/v3-periphery/interfaces/ISwapRouter.sol";

// libs
import "../external/uniswap/v3-core/libraries/TransferHelper.sol";
import "../external/uniswap/v3-periphery/libraries/BytesLib.sol";
import { Uint256Casting } from "../external/opyn/Uint256Casting.sol";
import { SafeMath } from "../external/openzeppelin/math/SafeMath.sol";
import "../libs/LiquidityLibrary.sol";

/**
 * @title UniV3LpVault
 * @author Duality (h/t to Uniswap's UniswapV3Staker as a starting point)
 */
contract UniV3LpVault is IUniV3LpVault {
    using SafeMath for uint256;
    using Uint256Casting for uint256;
    using BytesLib for bytes;

    address public override factory;

    INonfungiblePositionManager public override nonfungiblePositionManager;

    ISwapRouter public override swapRouter;

    ComptrollerInterface public override comptroller;

    IFlashLoanReceiver public override flashLoan;

    mapping(address => bool) public override flashLoanAuthorized;

    /// @dev ownerOf[tokenId] => address owner
    mapping(uint256 => address) public override ownerOf;

    /// @dev userTokens[userAddress] => tokenIds[]
    mapping(address => uint256[]) public userTokens;

    /// @notice max number of userTokens for a single userAddress
    uint256 public override userTokensMax = 4;

    /// @notice whether or not periphery functionality has been paused
    bool public peripheryGuardianPaused;

    /// @notice whether or not deposits have been paused
    bool public depositGuardianPaused;

    /// @dev Guard variable for re-entrancy checks
    bool internal _notEntered;

    constructor(
        address _factory,
        INonfungiblePositionManager _nonfungiblePositionManager,
        ISwapRouter _swapRouter,
        ComptrollerInterface _comptroller
    ) {
        factory = _factory;
        nonfungiblePositionManager = _nonfungiblePositionManager;
        swapRouter = _swapRouter;
        comptroller = _comptroller;
        _notEntered = true;
    }

    /*** External Mutator Functions ***/

    /// @dev Upon receiving a Uniswap V3 ERC721, creates the token deposit setting owner to `from`
    /// @inheritdoc IERC721Receiver
    function onERC721Received(
        address,
        address from,
        uint256 tokenId,
        bytes calldata
    ) external override nonReentrant(false) returns (bytes4) {
        require(!depositGuardianPaused, "deposit is paused");
        require(msg.sender == address(nonfungiblePositionManager), "IUniV3LpVault::onERC721Received: not a Uni V3 nft");

        _processNewToken(tokenId, from);
        emit TokenDeposited(from, tokenId);
        return this.onERC721Received.selector;
    }

    /**
     * @notice Withdraw a tokenId from the vault, so long as the caller's debt is still sufficiently collateralized
     * @param tokenId The tokenId of the NFT to be withdrawn
     * @param to The address to send tokenId to
     * @param data any data to provide for the safeTransferFrom call
     */
    function withdrawToken(
        uint256 tokenId,
        address to,
        bytes memory data
    ) external override nonReentrant(false) avoidsShortfall {
        require(to != address(this), "IUniV3LpVault::withdrawToken: cannot withdraw to vault");
        require(ownerOf[tokenId] == msg.sender, "IUniV3LpVault::withdrawToken: only owner can withdraw token");

        _deleteOldToken(msg.sender, tokenId);

        nonfungiblePositionManager.safeTransferFrom(address(this), to, tokenId, data);
        emit TokenWithdrawn(msg.sender, to, tokenId);
    }

    /**
     * @notice Seize fees and/or liquidity from a borrower's LP NFT, assuming the seizure is allowed.
     *          To be called exclusively from the CToken of the debt asset (Best mirroring original compound liquidation path)
     * @param liquidator The address of the EOA/Contract claiming the liquidation + incentive
     * @param borrower The address of the account currently in shortfall. Owner of tokenId.
     * @param tokenId The tokenId to be partially or fully liquidated. Owned by Borrower.
     * @param seizeFeesToken0 The amount of token0 to seize from tokenId's fees
     * @param seizeFeesToken1 The amount of token1 to seize from tokenId's fees
     * @param seizeLiquidity The amount of liquidity to convert to token0/token1 and seize
     */
    function seizeAssets(
        address liquidator,
        address borrower,
        uint256 tokenId,
        uint256 seizeFeesToken0,
        uint256 seizeFeesToken1,
        uint256 seizeLiquidity
    ) external override nonReentrant(true) {
        require(ownerOf[tokenId] == borrower, "borrower must own tokenId");

        // make call to comptroller to ensure seize is allowed
        uint256 allowed = ComptrollerInterface(comptroller).seizeAllowedUniV3(
            address(this),
            msg.sender,
            liquidator,
            borrower,
            tokenId,
            seizeFeesToken0,
            seizeFeesToken1,
            seizeLiquidity
        );

        // TODO: do we want some Comptroller like error handling/messaging here?
        require(allowed == 0, "seize not allowed according to Comptroller");

        if (seizeLiquidity > 0) {
            // liquidate seizeLiquidity from tokenId position
            _decreaseLiquidity(tokenId, uint128(seizeLiquidity));

            // claim all fees + tokens from liquidity removal
            nonfungiblePositionManager.collect(
                INonfungiblePositionManager.CollectParams(tokenId, liquidator, type(uint128).max, type(uint128).max)
            );
        } else {
            // claim feesAmountToken0 and feesAmountToken1 and send to liquidator
            nonfungiblePositionManager.collect(
                INonfungiblePositionManager.CollectParams(
                    tokenId,
                    liquidator,
                    uint128(seizeFeesToken0),
                    uint128(seizeFeesToken1)
                )
            );
        }
    }

    // TODO: do we want a "decreaseLiquidityAndCollect" function?

    /**
     * @notice Passthrough function to NonfungiblePositionManager for an owner of an NFT to decrease its liquidity.
     *          Checks that the user's position is still sufficiently collateralized after taking this action
     * @param params INonfungiblePositionManager's decreaseLiquidityParams for the passthrough call
     */
    function decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams calldata params)
        external
        override
        nonReentrant(false)
        isAuthorizedForToken(params.tokenId)
        avoidsShortfall
    {
        require(!peripheryGuardianPaused, "periphery functionality is paused");

        nonfungiblePositionManager.decreaseLiquidity(params);
        emit LiquidityDecreased(msg.sender, params.tokenId, params.liquidity);
    }

    /**
     * @notice Passthrough function to NonfungiblePositionManager for an owner of an NFT to collect its fees.
     *          Checks that the user's position is still sufficiently collateralized after taking this action
     * @param params INonfungiblePositionManager's CollectParams for the passthrough call
     */
    function collectFees(INonfungiblePositionManager.CollectParams calldata params)
        external
        override
        nonReentrant(false)
        isAuthorizedForToken(params.tokenId)
        avoidsShortfall
    {
        require(!peripheryGuardianPaused, "periphery functionality is paused");

        (uint256 amount0, uint256 amount1) = nonfungiblePositionManager.collect(params);
        emit FeesCollected(msg.sender, params.tokenId, amount0, amount1);
    }

    /**
     * @notice function for an owner of an NFT to automatically compound fees into liquidity of a range.
     *          Checks that the user's position is still sufficiently collateralized after taking this action
     *
     *          Target balance of fees for swap are pre-computed off-chain along with slippage tolerance.
     *
     *          Swap is made by swapping the extra of token0 (according to expectedAmount0) to token1, depositing
     *          the max liquidity possible (along with min checks), and any remnants left are sent back to the user
     *
     * @param params our CompoundFeesParams, described at definition in the interface
     */
    function compoundFees(CompoundFeesParams calldata params)
        external
        override
        nonReentrant(false)
        isAuthorizedForToken(params.tokenId)
        avoidsShortfall
    {
        require(!peripheryGuardianPaused, "periphery functionality is paused");

        // collect all fees
        (uint256 amount0, uint256 amount1) = _collectMax(params.tokenId);

        address token0;
        address token1;

        {
            // avoid stack too deep
            uint24 fee;
            (, , token0, token1, fee, , , , , , , ) = nonfungiblePositionManager.positions(params.tokenId);

            // trade assets to expectedAmounts (assuming correct off-chain computation)
            (amount0, amount1) = _prepareForDeposit(
                token0,
                token1,
                fee,
                params.expectedAmount0,
                params.expectedAmount1,
                amount0,
                amount1
            );
        }

        // attempt to deposit amount0 and amount1 into our range
        (uint256 amountTaken0, uint256 amountTaken1) = _increaseLiquidity(
            params.tokenId,
            token0,
            token1,
            amount0,
            amount1,
            params.amount0Min,
            params.amount1Min
        );

        uint256 amountReturned0 = amount0 > amountTaken0 ? amount0.sub(amountTaken0) : 0;
        uint256 amountReturned1 = amount1 > amountTaken1 ? amount1.sub(amountTaken1) : 0;

        // send back remnants to user
        if (amountReturned0 > 0) TransferHelper.safeTransfer(token0, msg.sender, amountReturned0);
        if (amountReturned1 > 0) TransferHelper.safeTransfer(token1, msg.sender, amountReturned1);
        emit FeesCompounded(msg.sender, params.tokenId, amountTaken0, amountTaken1, amountReturned0, amountReturned1);
    }

    /**
     * @notice function for an owner of an NFT to move liquidity of one range into a new range.
     *          Checks that the user's position is still sufficiently collateralized after taking this action
     *
     *          Target balance of fees for swap are pre-computed off-chain along with slippage tolerance.
     *
     *          Swap is made by swapping the extra of token0 (according to expectedAmount0) to token1, depositing
     *          the max liquidity possible (along with min checks), and any remnants left are sent back to the user
     *
     * @param params our MoveRangeParams, described at definition in the interface
     * @return newTokenId The tokenId of our new Uni V3 LP position
     */
    function moveRange(MoveRangeParams calldata params)
        external
        override
        nonReentrant(false)
        isAuthorizedForToken(params.tokenId)
        avoidsShortfall
        returns (uint256 newTokenId)
    {
        require(!peripheryGuardianPaused, "periphery functionality is paused");

        // remove params.liquidity from token (moves to token's fees)
        if (params.liquidity > 0) _decreaseLiquidity(params.tokenId, params.liquidity);

        // collect all fees (includes decreased liquidity)
        (uint256 amount0, uint256 amount1) = _collectMax(params.tokenId);

        (, , address token0, address token1, uint24 fee, , , , , , , ) = nonfungiblePositionManager.positions(
            params.tokenId
        );

        // trade assets to expectedAmounts (assuming correct off-chain computation)
        (amount0, amount1) = _prepareForDeposit(
            token0,
            token1,
            fee,
            params.expectedAmount0,
            params.expectedAmount1,
            amount0,
            amount1
        );

        // prepare mintParams
        INonfungiblePositionManager.MintParams memory mintParams = INonfungiblePositionManager.MintParams(
            token0,
            token1,
            fee,
            params.newTickLower,
            params.newTickUpper,
            amount0,
            amount1,
            params.amount0Min,
            params.amount1Min,
            msg.sender, // _mint utilizes this appropriately
            block.timestamp + 200
        );

        // burn old token if emptied
        (, , , , , , , uint128 newLiquidity, , , , ) = nonfungiblePositionManager.positions(params.tokenId);
        if (newLiquidity == 0) _burn(msg.sender, params.tokenId);

        {
            uint256 amountTaken0;
            uint256 amountTaken1;

            // mint new range
            (newTokenId, amountTaken0, amountTaken1) = _mint(mintParams);

            // send back remnants to user
            if (amount0 > amountTaken0) TransferHelper.safeTransfer(token0, msg.sender, amount0.sub(amountTaken0));
            if (amount1 > amountTaken1) TransferHelper.safeTransfer(token1, msg.sender, amount1.sub(amountTaken1));
        }

        emit RangeMoved(msg.sender, params.tokenId, newTokenId, params.liquidity, newLiquidity == 0);
    }

    /**
     * @notice function only to be called by flashloan contract initiated from the NFT owner
     * @param params our MoveRangeParams, described at definition in the interface
     */
    function flashFocusCall(FlashFocusParams calldata params) external override {
        address owner = ownerOf[params.tokenId];
        (, , address token0, address token1, , , , , , , , ) = nonfungiblePositionManager.positions(params.tokenId);

        bool tokenOfPool = params.asset == token0 || params.asset == token1;

        require(!peripheryGuardianPaused, "periphery functionality is paused");
        require(msg.sender == address(flashLoan), "Can only be called from our flashLoan contract");
        require(flashLoanAuthorized[owner], "flashLoan action must have been authorized by tokenId owner");
        require(
            tokenOfPool || params.swapPath.length > 0,
            "flashLoaned asset must be a pool asset or swapping to token0"
        );
        require(_checkSwapPath(params.swapPath, params.asset, token0), "swapPath did not pass integrity check");

        flashLoanAuthorized[owner] = false;

        // transfer flashLoaned assets to vault
        IERC20Detailed(params.asset).transferFrom(msg.sender, address(this), params.amount);

        uint256 amount0;
        uint256 amount1;

        {
            // creating local scope, avoiding stack too deep

            // calculate our starting amounts of each asset
            uint256 amountIn0 = params.asset == token0 ? params.amount : 0;
            uint256 amountIn1 = params.asset == token1 ? params.amount : 0;

            // swap everything to token0 if swap path is provided and params.asset is neither of the tokens
            if (!tokenOfPool && params.swapPath.length > 0) amountIn0 = _swap(params.swapPath, params.amount);

            (, , , , uint24 fee, , , , , , , ) = nonfungiblePositionManager.positions(params.tokenId);

            // trade assets to expectedAmounts (assuming correct off-chain computation)
            (amount0, amount1) = _prepareForDeposit(
                token0,
                token1,
                fee,
                params.expectedAmount0,
                params.expectedAmount1,
                amountIn0,
                amountIn1
            );
        }

        // attempt to deposit amount0 and amount1 into our range
        (uint256 amountTaken0, uint256 amountTaken1) = _increaseLiquidity(
            params.tokenId,
            token0,
            token1,
            amount0,
            amount1,
            params.amount0Min,
            params.amount1Min
        );

        {
            // another local scope :)
            uint256 owedBack = params.amount.add(params.premium);

            // borrow the flashloaned asset in preparation for closing loan
            uint256 success = CErc20Interface(comptroller.cTokensByUnderlying(params.asset)).borrowBehalf(
                owner,
                owedBack
            );
            require(success == 0, "borrow failed");

            // approve borrowed assets for flashLoan to pull
            IERC20Detailed(params.asset).approve(msg.sender, owedBack);
        }

        uint256 amountReturned0 = amount0 > amountTaken0 ? amount0.sub(amountTaken0) : 0;
        uint256 amountReturned1 = amount1 > amountTaken1 ? amount1.sub(amountTaken1) : 0;

        // send back remnants to user
        if (amountReturned0 > 0) TransferHelper.safeTransfer(token0, msg.sender, amountReturned0);
        if (amountReturned1 > 0) TransferHelper.safeTransfer(token1, msg.sender, amountReturned1);
        emit FlashFocus(
            msg.sender,
            params.tokenId,
            params.asset,
            params.amount,
            amountTaken0,
            amountTaken1,
            amountReturned0,
            amountReturned1
        );
    }

    /**
     * @notice function for an owner of an NFT to be able enter into a focused position in one click.
     *          Allows a user, via flashloan, to open debt and re-deposit as liquidity into their NFT range
     *          up to max leverage in one tx.
     *          Reentrancy guard must be local, or split up around call to CToken
     * @param params our FlashFocusParams, described at definition in the interface
     */
    function flashFocus(FlashFocusParams calldata params)
        external
        override
        nonReentrant(true)
        isAuthorizedForToken(params.tokenId)
        avoidsShortfall
    {
        require(!peripheryGuardianPaused, "periphery functionality is paused");
        address receiverAddress = address(flashLoan);

        address[] memory assets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        uint256[] memory modes = new uint256[](1);

        assets[0] = params.asset;
        amounts[0] = params.amount;
        modes[0] = 0;

        address onBehalfOf = address(this);
        bytes memory newParams = abi.encode(params);
        uint16 referralCode = 0;

        flashLoanAuthorized[msg.sender] = true;
        flashLoan.LENDING_POOL().flashLoan(
            receiverAddress,
            assets,
            amounts,
            modes,
            onBehalfOf,
            newParams,
            referralCode
        );
    }

    /**
     * @notice function for an owner of an NFT to be able to repay a debt using an NFT in one click.
     *          Allows a user to repay debt by removing liquidity / fees from an NFT and swapping to
     *          the debt token in one tx.
     * @param params our RepayDebtParams, described at definition in the interface
     * @return amountReturned The amount of the debtToken returned to the function caller
     */
    function repayDebt(RepayDebtParams calldata params)
        external
        override
        nonReentrant(true)
        isAuthorizedForToken(params.tokenId)
        avoidsShortfall
        returns (uint256 amountReturned)
    {
        require(!peripheryGuardianPaused, "periphery functionality is paused");
        require(comptroller.markets(params.debtCToken).isListed, "Debt CToken must be listed by comptroller");
        require(
            params.underlying == CErc20Interface(params.debtCToken).underlying(),
            "Underlying must match CToken underlying"
        );

        (, , address token0, address token1, , , , , , , , ) = nonfungiblePositionManager.positions(params.tokenId);
        require(_checkSwapPath(params.swapPath0, token0, params.underlying), "swapPath0 did not pass integrity check");
        require(_checkSwapPath(params.swapPath1, token1, params.underlying), "swapPath1 did not pass integrity check");

        // remove params.liquidity from token (moves to token's fees)
        if (params.liquidity > 0) _decreaseLiquidity(params.tokenId, params.liquidity);

        uint256 amountOutTotal;

        {
            // collect all fees (includes decreased liquidity)
            (uint256 amount0, uint256 amount1) = _collectMax(params.tokenId);

            // calculate the totalAmount of debt asset we have.
            // check if token0 or token1 are the debt asset. otherwise, swap token0 and token1 to debt asset using swapPaths
            uint256 amountOutFrom0 = token0 == params.underlying ? amount0 : 0;
            uint256 amountOutFrom1 = token1 == params.underlying ? amount1 : 0;

            if (amountOutFrom0 == 0 && params.swapPath0.length > 0) amountOutFrom0 = _swap(params.swapPath0, amount0);
            if (amountOutFrom1 == 0 && params.swapPath1.length > 0) amountOutFrom1 = _swap(params.swapPath1, amount1);

            // total amount of debtAsset we've collected to use towards repay
            amountOutTotal = amountOutFrom0.add(amountOutFrom1);
        }

        require(
            amountOutTotal > params.repayAmount,
            "not enough liquidity burned: Repay debt must repay repayAmount of debt"
        );

        // repay the debt for user with new funds
        IERC20Detailed(params.underlying).approve(address(params.debtCToken), params.repayAmount);
        uint256 succeeded = CErc20Interface(params.debtCToken).repayBorrowBehalf(msg.sender, params.repayAmount);
        require(succeeded == 0, "repay debt did not succeed");
        IERC20Detailed(params.underlying).approve(address(params.debtCToken), 0);

        // return remnants to user
        amountReturned = amountOutTotal > params.repayAmount ? amountOutTotal.sub(params.repayAmount) : 0;

        if (amountReturned > 0) TransferHelper.safeTransfer(params.underlying, msg.sender, amountReturned);

        emit RepayDebt(
            msg.sender,
            params.tokenId,
            params.liquidity,
            params.debtCToken,
            params.underlying,
            params.repayAmount,
            amountReturned
        );
    }

    /*** External View Functions ***/

    /**
     * @notice gets the length of UserTokens for an account. Allows comptroller to query NFTs for value
     * @param account The address of the account we want the user tokens length for
     * @return length The length of the user's userTokens array
     */
    function getUserTokensLength(address account) external view override returns (uint256 length) {
        length = userTokens[account].length;
    }

    /**
     * @notice gets the poolAddress for a deposited tokenId
     * @param tokenId The tokenId to get the poolAddress of
     * @return poolAddress The address of the pool the token is a deposit of
     */
    function getPoolAddress(uint256 tokenId) external view override returns (address poolAddress) {
        poolAddress = _getPoolAddress(tokenId);
    }

    /*** Internal Mutator Functions ***/

    /**
     * @notice Internal function to prepare for a deposit liquidity into a Uni V3 range.
     *          uses a pool to swap amount0 and amount1 to expectedAmount0 and expectedAmount1.
     *          uses naive logic, assumes adequate off-chain computation for expectedAmounts
     *
     * @param token0 Address of token0
     * @param token1 Address of token1
     * @param fee Fee of the pool to swap with
     * @param expectedAmount0 The amount of token0 that we expect to deposit into a range
     * @param expectedAmount1 The amount of token1 that we expect to deposit into a range
     * @param amount0 The amount of token0 that we currently hold and are preparing for deposit (some may be swapped for token1)
     * @param amount1 The amount of token1 that we currently hold and are preparing for deposit (some may be swapped for token1)
     * @return newAmount0 Amount of token0 after preparation
     *         newAmount1 Amount of token1 after preparation
     */
    function _prepareForDeposit(
        address token0,
        address token1,
        uint24 fee,
        uint256 expectedAmount0,
        uint256 expectedAmount1,
        uint256 amount0,
        uint256 amount1
    ) internal returns (uint256 newAmount0, uint256 newAmount1) {
        if (expectedAmount0 < amount0) {
            // have extra token0, trade all of the extra to token1
            uint256 amountOut = _swap(abi.encodePacked(token0, fee, token1), amount0.sub(expectedAmount0));
            newAmount0 = expectedAmount0;
            newAmount1 = amount1.add(amountOut);
        } else if (expectedAmount1 < amount1) {
            // have extra of token1, trade all of the extra to token0
            uint256 amountOut = _swap(abi.encodePacked(token1, fee, token0), amount1.sub(expectedAmount1));
            newAmount0 = amount0.add(amountOut);
            newAmount1 = expectedAmount1;
        } else {
            newAmount0 = amount0;
            newAmount1 = amount1;
        }
    }

    /**
     * @notice Executes a swap. Performs necessary approval beforehand, and zeros out afterwards for safety
     * @param swapPath The path to swap along
     * @param amount The amount of the first token to swap
     */
    function _swap(bytes memory swapPath, uint256 amount) internal returns (uint256 amountOut) {
        IERC20Detailed(swapPath.toAddress(0)).approve(address(swapRouter), amount);
        amountOut = swapRouter.exactInput(
            ISwapRouter.ExactInputParams(swapPath, address(this), block.timestamp + 200, amount, 0)
        );
        IERC20Detailed(swapPath.toAddress(0)).approve(address(swapRouter), 0);
    }

    /**
     * @notice Increases liquidity of a Uni V3 NFT
     * @param tokenId The tokenId of the NFT we are depositing liquidity into
     * @param token0 The address of the first token of the pool
     * @param token1 The address of the second token of the pool
     * @param amount0 The amount of token0 that we expect to deposit
     * @param amount1 The amount of token1 that we expect to deposit
     * @param amount0Min The min amount of token0 that we are willing to deposit (slippage check)
     * @param amount1Min The min amount of token1 that we are willing to deposit (slippage check)
     * @return amountOut0 Amount of token0 deposited into tokenId
     *         amountOut1 Amount of token1 deposited into tokenId
     */
    function _increaseLiquidity(
        uint256 tokenId,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 amount0Min,
        uint256 amount1Min
    ) internal returns (uint256 amountOut0, uint256 amountOut1) {
        IERC20Detailed(token0).approve(address(nonfungiblePositionManager), amount0);
        IERC20Detailed(token1).approve(address(nonfungiblePositionManager), amount1);

        // deposit liquidity into tokenId
        (, amountOut0, amountOut1) = nonfungiblePositionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams(
                tokenId,
                amount0,
                amount1,
                amount0Min,
                amount1Min,
                block.timestamp + 200
            )
        );

        IERC20Detailed(token0).approve(address(nonfungiblePositionManager), 0);
        IERC20Detailed(token1).approve(address(nonfungiblePositionManager), 0);
    }

    /**
     * @notice Decreases liquidity of a Uni V3 NFT
     * @param tokenId The tokenId of the NFT we are decreasing liquidity of
     * @param liquidity The amount of liquidity that we will be decreasing of tokenId
     */
    function _decreaseLiquidity(uint256 tokenId, uint128 liquidity) internal {
        nonfungiblePositionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams(tokenId, liquidity, 0, 0, block.timestamp + 200)
        );
    }

    /**
     * @notice Collects the maximum amount of fees available from the NFT to this contract
     * @param tokenId The tokenId of the NFT we are collecting fees from
     */
    function _collectMax(uint256 tokenId) internal returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = nonfungiblePositionManager.collect(
            INonfungiblePositionManager.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max)
        );
    }

    /**
     * @notice mints a fresh Uni V3 NFT on behalf of a user of this contract.
     *          Ownership of the mint is replaced with this contract, and the new token is then processed as a new token
     *          in this contract under the user's ownership
     * @param params NonfungiblePositionManager's MintParams. Acts as a passthrough except for ownership management
     */
    function _mint(INonfungiblePositionManager.MintParams memory params)
        internal
        returns (
            uint256 tokenId,
            uint256 amount0,
            uint256 amount1
        )
    {
        IERC20Detailed(params.token0).approve(address(nonfungiblePositionManager), params.amount0Desired);
        IERC20Detailed(params.token1).approve(address(nonfungiblePositionManager), params.amount1Desired);

        (tokenId, , amount0, amount1) = nonfungiblePositionManager.mint(
            INonfungiblePositionManager.MintParams(
                params.token0,
                params.token1,
                params.fee,
                params.tickLower,
                params.tickUpper,
                params.amount0Desired,
                params.amount1Desired,
                params.amount0Min,
                params.amount1Min,
                address(this), // replace recipient, and denote owner on deposit entry
                params.deadline
            )
        );

        IERC20Detailed(params.token0).approve(address(nonfungiblePositionManager), 0);
        IERC20Detailed(params.token1).approve(address(nonfungiblePositionManager), 0);

        // process the token for our internal accounting with the correct recipient
        _processNewToken(tokenId, params.recipient);
    }

    /**
     * @notice burns a Uni V3 NFT on behalf of a user of this contract.
     *          Manages accounting, deleting user ownership of this token in this contract
     * @param user Address of the user we are burning the token on behalf of
     * @param tokenId The Id of the Uni V3 NFT that we are burning
     */
    function _burn(address user, uint256 tokenId) internal {
        _deleteOldToken(user, tokenId);
        nonfungiblePositionManager.burn(tokenId);
    }

    /**
     * @notice processes a new token, checking that the NFT deposit is valid and adding to contract accounting
     *          on behalf of user
     * @param tokenId The Id of the Uni V3 NFT being processed
     * @param account Address of the user we are processing on behalf of
     */
    function _processNewToken(uint256 tokenId, address account) internal {
        require(userTokens[account].length < userTokensMax, "Cannot process new token: user has too many tokens");
        // get poolAddress via helper
        address poolAddress = _getPoolAddress(tokenId);
        require(
            comptroller.isSupportedPool(poolAddress),
            "comptroller does not support this pool's liquidity as collateral"
        );

        userTokens[account].push(tokenId);
        ownerOf[tokenId] = account;
    }

    /**
     * @notice deletes an old token from internal accounting
     * @param user Address of the user we are deleting the token on behalf of
     * @param tokenId The tokenId to be deleted from accounting
     */
    function _deleteOldToken(address user, uint256 tokenId) internal {
        uint256[] memory userTokensArr = userTokens[user];
        uint256 len = userTokensArr.length;
        uint256 assetIndex = len;

        for (uint256 i = 0; i < len; i++) {
            if (userTokensArr[i] == tokenId) {
                assetIndex = i;
                break;
            }
        }

        // We *must* have found the asset in the list or our redundant data structure is broken
        assert(assetIndex < len);

        // copy last item in list to location of item to be removed, reduce length by 1
        uint256[] storage storedList = userTokens[user];
        storedList[assetIndex] = storedList[storedList.length - 1];
        storedList.pop();

        delete ownerOf[tokenId];
    }

    /*** Internal View Functions ***/

    function _getPoolAddress(uint256 tokenId) internal view returns (address poolAddress) {
        (, , address token0, address token1, uint24 fee, , , , , , , ) = nonfungiblePositionManager.positions(tokenId);
        poolAddress = LiquidityLibrary._getPoolAddress(factory, token0, token1, fee);
    }

    /**
     * @notice Checks that swapPath, if non-empty, starts and ends with the appropriate tokens.
     *          Doesn't check that the swap path is of proper length, as this will be checked upon use in swapRouter
     * @param swapPath The swapPath that we are checking
     * @param tokenStart The expected starting point token of swapPath
     * @param tokenEnd The expected ending point token of swapPath
     * @return check The boolean result of whether or not the swapPath has passed our checks
     */
    function _checkSwapPath(
        bytes memory swapPath,
        address tokenStart,
        address tokenEnd
    ) internal pure returns (bool check) {
        check =
            swapPath.length == 0 ||
            (swapPath.toAddress(0) == tokenStart && swapPath.toAddress(swapPath.length - 20) == tokenEnd);
    }

    /*** Modifiers ***/

    // Need to ensure for all modifying functions that can decrease liquidity in this contract that we don't enter shortfall
    modifier avoidsShortfall() {
        _;
        (, , uint256 shortfall) = comptroller.getAccountLiquidity(msg.sender);
        require(shortfall == 0, "insufficient liquidity");
    }

    modifier isAuthorizedForToken(uint256 tokenId) {
        require(ownerOf[tokenId] == msg.sender, "sender must be owner of deposited tokenId");
        _;
    }

    /*** Admin Functions ***/

    /**
     * @notice set state of whether or not vault deposits are paused
     * @param state new value for whether deposits are paused
     */
    function _pauseDeposits(bool state) external override returns (bool) {
        require(
            msg.sender == comptroller.pauseGuardian() || msg.sender == comptroller.admin(),
            "only pause guardian and admin can pause"
        );
        require(msg.sender == comptroller.admin() || state == true, "only admin can unpause");

        depositGuardianPaused = state;
        emit ActionPaused("Deposit", state);
        return state;
    }

    /**
     * @notice set state of whether or not periphery UX functions are paused
     * @param state new value for whether periphery UX functions are paused
     */
    function _pausePeripheryFunctions(bool state) external override returns (bool) {
        require(
            msg.sender == comptroller.pauseGuardian() || msg.sender == comptroller.admin(),
            "only pause guardian and admin can pause"
        );
        require(msg.sender == comptroller.admin() || state == true, "only admin can unpause");

        peripheryGuardianPaused = state;
        emit ActionPaused("Periphery", state);
        return state;
    }

    /**
     * @notice set new address for flashloan contract as a contract comptroller.admin()
     * @param _flashLoan the new flashLoan contract's address
     */
    function _setFlashLoan(address _flashLoan) external override returns (address) {
        require(msg.sender == comptroller.admin(), "only admin can set FlashLoanContract");
        address oldFlashLoan = address(flashLoan);
        flashLoan = IFlashLoanReceiver(_flashLoan);
        emit NewFlashLoanContract(oldFlashLoan, _flashLoan);
        return _flashLoan;
    }

    /**
     * @notice set new userTokensMax as a contract comptroller.admin()
     * @param _userTokensMax the new value for userTokensMax
     */
    function _setUserTokensMax(uint256 _userTokensMax) external override returns (uint256) {
        require(msg.sender == comptroller.admin(), "only admin can set new userTokensMax");
        uint256 oldUserTokensMax = userTokensMax;
        userTokensMax = _userTokensMax;
        emit NewUserTokensMax(oldUserTokensMax, _userTokensMax);
        return userTokensMax;
    }

    /**
     * @notice Removes tokens accidentally sent to this vault.
     * @param token address of token to sweep
     * @param to address to send token to
     * @param amount amount to token to sweep
     */
    function _sweep(
        address token,
        address to,
        uint256 amount
    ) external override {
        require(msg.sender == comptroller.admin(), "only admin can sweep assets");
        TransferHelper.safeTransfer(token, to, amount);
    }

    /**
     * @notice Removes NFTs accidentally sent to this vault.
     * @param nftContract address of nftContract
     * @param tokenId tokenId of NFT to sweep
     * @param to address to send NFT to
     */
    function _sweepNFT(
        address nftContract,
        address to,
        uint256 tokenId
    ) external override {
        require(msg.sender == comptroller.admin(), "only admin can sweep nft assets");
        require(
            nftContract != address(nonfungiblePositionManager) || ownerOf[tokenId] == address(0),
            "only NFTs not belonging to depositors can be swept"
        );
        IERC721(nftContract).safeTransferFrom(address(this), to, tokenId);
    }

    /*** Reentrancy Guard ***/

    /**
     * @notice Prevents a contract from calling itself, directly or indirectly.
     */
    modifier nonReentrant(bool localOnly) {
        _beforeNonReentrant(localOnly);
        _;
        _afterNonReentrant(localOnly);
    }

    /**
     * @dev Split off from `nonReentrant` for contract size optimization
     * Saves space because function modifier code is "inlined" into every function with the modifier).
     */
    function _beforeNonReentrant(bool localOnly) private {
        require(_notEntered, "re-entered");
        if (!localOnly) comptroller._beforeNonReentrant();
        _notEntered = false;
    }

    /**
     * @dev Split off from `nonReentrant` for contract size optimization
     * Saves space because function modifier code is "inlined" into every function with the modifier).
     */
    function _afterNonReentrant(bool localOnly) private {
        _notEntered = true; // get a gas-refund post-Istanbul
        if (!localOnly) comptroller._afterNonReentrant();
    }
}
