## Directories

`compound_fork` contains all Compound (& solidity version 0.5.16) sol files in it's original flat structure, with additions made in matching style and with unnecessary files removed.

All other directories and files are of solidity version 0.7.6 or compatible.

`external` contains all imports inline, with individual READMEs for versions and github links where applicable.

`libs` libraries. Most code is only slightly altered from other sources (uniswap, opyn) as noted in file comments.

`interfaces` interfaces.

`vault_and_oracles` our LpVault and Oracle implementations. Includes our flashLoan contract implementation for LpVault periphery functionality ("focus")

`test` contains stubs of contracts for unit testing.

## High Level Overview

- Comptroller and and CTokens maintain most all of their original functionality. The best starting point to see the differences is `getHypotheticalAccountLiquidityInternal`, which contains `addNFTCollateral` to add deposited Uni V3 LP NFT's borrow power.
- `addNFTCollateral` iterates through a users NFTs deposited in `uniV3LpVault`. It gets the token breakdown of the NFT according to tickOracle's TWAP tick, pulls the collateralFactor for that pool, and from there applies very similar computations to if these balances were the underlying balances of cToken deposits.
- This brings us to `UniV3LpVault`, which has a max number of NFTs that can be deposited per user. Which pools are supported as deposits is determined by the comptroller's mapping of `isSupportedPool`.
- Liquidations follow a parallel code path to Compound's original liquidations. This means we start with CTokens, at `liquidateBorrowUniV3`. (it's worth noting here that we only utilize CErc20's for simplicity). This codepath follows as closely as possible to the original `liquidateBorrow` implementation.

We're planning on providing more documentation, but these two entry points (`addNFTCollateral` and `liquidateBorrowUniV3`) with general browsing of `UniV3LpVault` should bring you across all the unique features we've brought in our augmentation of the original Compound design.

Check our documentation for more high-level details:
https://dualitylabs.gitbook.io/duality/
