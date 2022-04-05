# Duality Focus contest details
- $30,000 USDC main award pot
- $0 USDC gas optimization award pot
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2022-04-duality-focus-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts April 6, 2022 00:00 UTC
- Ends April 8, 2022 23:59 UTC

# Contest Scope

The following contracts are in scope (with their line counts):
| File | statements | branches | functions | Lines (excluding global variable declarations, function signatures , run over lines and event definitions) |
| -------------------- | ---------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| CErc20.sol | 31 | 8	| 14 | 30 |
| CErc20Immutable.sol | 3	| 0	| 1	| 3 |
| CToken.sol | 437 | 232 | 53 | 437 |
| Comptroller.sol	| 404	| 234	| 48 | 424 |
| UniV3LpVault.sol | 215	| 114	| 35 | 209 |
| FlashLoan.sol	| 15 | 4 | 2 | 15 |
| MasterPriceOracle.sol | 24 | 18 | 6 | 22 |
| UniswapTwapOracle.sol	| 31 | 16 | 10	| 32 |
| TOTAL | 1160 | 626 | 169 | 1172 |

<br>

All libraries used in the above contracts are also within scope, especially those written by Duality (contracts/libs). Below is an outline of contract external and library dependencies.

#### CErc20.sol
- External Called Contracts: CToken.sol
#### CToken.sol
- External Called Contracts: Comptroller.sol
#### Comptroller.sol
- External Called Contracts: CErc20.sol, UniV3LpVault.sol, oracles
#### UniV3LpVault.sol
- External Called Contracts: Comptroller.sol, FlashLoan.sol, TickOracle.sol, NonfungiblePositionManager.sol (v3-periphery), SwapRouter.sol (v3-periphery)
- Libraries: TransferHelper.sol (v3-core), BytesLib.sol (v3-periphery), Uint256Casting.sol (opyn), LiquidityLibrary.sol (ours), SafeMath.sol (OpenZeppelin)
#### FlashLoan.sol
- External Called Contracts: UniV3LpVault.sol
- Libraries: FlashLoan Receiver (aave)
#### UniswapTwapOracle.sol
- External Called Contracts: UniswapV3Pool.sol (v3-core)
- Libraries: UniswapTwapLibrary.sol (ours), LpBreakdownLibrary.sol (ours), SafeMath.sol (OpenZeppelin), UInt256Casting.sol (opyn)

# Duality Focus Overview
Duality Focus is a money market where both ERC-20 assets and Uniswap V3 liquidity positions are accepted as collateral. On Focus, users can engage in familiar DeFi operations like lending and borrowing ERC-20 assets. However, because we underwrite Uniswap V3 positions from selected pools, new usecases become possible. Users can supply their V3 ranges as additional collateral and get access to additional borrow power. Our flagship usecase is "focus": users can leverage ranges with supported ERC-20 assets, increasing fees earned. They can also move liquidity, move positions to different ticks, and compound fees, all with a single click.

We plan to launch Focus on Polygon first, but eventually every chain that Uniswap V3 is deployed on. 

## Contract Architecture
Focus is a combination of modified Compound contracts, modified Rari Capital contracts, Uniswap V3 dependencies, and custom contracts.
At a high level, our contracts consist of:
- Forked Compound base contracts and forked Rari Capital contracts for the money market implementation
  - The main modifications are to support valuing and liquidating Uniswap V3 collateral
- LP Vault contract that holds all Uniswap V3 ranges. 
  - Supports all new range operations we introduce: focusing ranges, repaying debt from ranges, compounding fees, and moving ranges. Also supports other Uniswap V3 NonfungiblePositionManager operations like adding and removing liquidity. 
  - Supports partially seizing assets from a range in the case of a liquidation.
- Oracle contract that supports Uniswap V3 ranges.

The commit log reflects these changes and we recommend using commits to understand the changes we have introduced to Rari/Compound. We describe them below:
<br>
<br>
[COMMIT 1]: Adds all of the non-contract files of our repo
<br>
[COMMIT 2]: Add Rari Fork (no changes yet). We add only the files we utilize, and we add them in their original form. You can assume that these files are mostly safe at this stage.
<br>
[COMMIT 3]: Add a couple files we need from compound, and clean up our compound/rari fork by removing unnecessary code and shift to a simpler admin model.
<br>
[COMMIT 4]: Add Focus specific changes to our compound/rari fork. This includes functions for both valuing and liquidating LP NFTs
<br>
[COMMIT 5]: Add all 0.7.6 code: includes our LP Vault and oracles, along with the internal/external libraries they call. 
<br>
[COMMIT 6]: Add contracts for tests/mocks


More information on contracts can be found in [the contracts README](https://github.com/code-423n4/2022-04-dualityfocus/blob/e4bc33c0eb6be79bf1346b4a6c50b3e18964b589/contracts/README.md). Please also refer to our Gitbook docs linked below.

## Known Issues/Tradeoffs
- **Uniswap V3 TWAP manipulation**

  An attacker manipulating a Uniswap V3 pool tick could manipulate the value of a collateral V3 position. We are planning to have a strict criteria for supported assets and Uniswap V3 pools. At launch, we plan to only support blue-chip Polygon assets and high-TVL pools (see the full list [here](https://dualitylabs.gitbook.io/duality/duality-focus/supported-assets-pools)). This is an active area of research for us as we onboard new assets and pools. We are also considering using Chainlink oracles instead.

- **Upgradeability**

  We have removed Compound's CToken and Comptroller upgradeability. However, the admin can update the LP Vault contract address, and can also update the oracle used for a given asset.
  
## How to get started

First make a `.env` file as in `.env.example`.

To install necessary libraries and build our types:

```
yarn install && yarn typechain
```

To compile contracts:

```
yarn compile
```

And to run tests:

```
yarn test
```

# Resources
## Duality Links
- [Blog](https://mirror.xyz/0x426D702b3ECc4a2f50E575413f20642bbDB8965e)
- [Gitbook](https://dualitylabs.gitbook.io/duality/)
- [Website](https://www.dualityfi.xyz/)
- [Discord](https://discord.gg/nDRCdF6Bnc)
- [Twitter](https://twitter.com/DualityFi)
## Other Links
- [Compound Docs](https://compound.finance/docs)
- [Rari Capital Docs](https://docs.rari.capital/)
- [Uniswap V3 Docs](https://docs.uniswap.org/protocol/reference/smart-contracts)
## Contact Us
- Drama
  - Discord: DramaOne#4728
  - [Twitter](https://twitter.com/0xdramaone)
- Kismet 
  - Discord: kismet108#7212
  - [Twitter](https://twitter.com/kismet108)
