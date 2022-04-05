# ✨ So you want to sponsor a contest

This `README.md` contains a set of checklists for our contest collaboration.

Your contest will use two repos: 
- **a _contest_ repo** (this one), which is used for scoping your contest and for providing information to contestants (wardens)
- **a _findings_ repo**, where issues are submitted. 

Ultimately, when we launch the contest, this contest repo will be made public and will contain the smart contracts to be reviewed and all the information needed for contest participants. The findings repo will be made public after the contest is over and your team has mitigated the identified issues.

Some of the checklists in this doc are for **C4 (🐺)** and some of them are for **you as the contest sponsor (⭐️)**.

---

# Contest setup

## ⭐️ Sponsor: Provide contest details

Under "SPONSORS ADD INFO HERE" heading below, include the following:

- [ ] Name of each contract and:
  - [ ] source lines of code (excluding blank lines and comments) in each
  - [ ] external contracts called in each
  - [ ] libraries used in each
- [ ] Describe any novel or unique curve logic or mathematical models implemented in the contracts
- [ ] Does the token conform to the ERC-20 standard? In what specific ways does it differ?
- [ ] Describe anything else that adds any special logic that makes your approach unique
- [ ] Identify any areas of specific concern in reviewing the code
- [ ] Add all of the code to this repo that you want reviewed
- [ ] Create a PR to this repo with the above changes.

---

# Contest prep

## 🐺 C4: Contest prep
- [X] Rename this repo to reflect contest date (if applicable)
- [X] Rename contest H1 below
- [X] Add link to report form in contest details below
- [X] Update pot sizes
- [X] Fill in start and end times in contest bullets below.
- [ ] Move any relevant information in "contest scope information" above to the bottom of this readme.
- [ ] Add matching info to the [code423n4.com public contest data here](https://github.com/code-423n4/code423n4.com/blob/main/_data/contests/contests.csv))
- [ ] Delete this checklist.

## ⭐️ Sponsor: Contest prep
- [ ] Make sure your code is thoroughly commented using the [NatSpec format](https://docs.soliditylang.org/en/v0.5.10/natspec-format.html#natspec-format).
- [X] Modify the bottom of this `README.md` file to describe how your code is supposed to work with links to any relevent documentation and any other criteria/details that the C4 Wardens should keep in mind when reviewing. ([Here's a well-constructed example.](https://github.com/code-423n4/2021-06-gro/blob/main/README.md))
- [ ] Please have final versions of contracts and documentation added/updated in this repo **no less than 8 hours prior to contest start time.**
- [X] Ensure that you have access to the _findings_ repo where issues will be submitted.
- [X] Promote the contest on Twitter (optional: tag in relevant protocols, etc.)
- [X] Share it with your own communities (blog, Discord, Telegram, email newsletters, etc.)
- [ ] Optional: pre-record a high-level overview of your protocol (not just specific smart contract functions). This saves wardens a lot of time wading through documentation.
- [ ] Delete this checklist and all text above the line below when you're ready.

---

# Duality Focus contest details
- $28,500 USDC main award pot
- $1,500 USDC gas optimization award pot
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2022-04-duality-focus-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts April 6, 2022 00:00 UTC
- Ends April 8, 2022 23:59 UTC

This repo will be made public before the start of the contest. (C4 delete this line when made public)

# Contest Scope
**TODO**:


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


More information on contracts can be found here [**TODO: link to contracts readme**]. Please also refer to our Gitbook docs linked below.

## Known Issues/Tradeoffs
- **Uniswap V3 TWAP manipulation**

  An attacker manipulating a Uniswap V3 pool tick could manipulate the value of a collateral V3 position. We are planning to have a strict criteria for supported assets and Uniswap V3 pools. At launch, we plan to only support blue-chip Polygon assets and high-TVL pools (see the full list [here](https://dualitylabs.gitbook.io/duality/duality-focus/supported-assets-pools)). This is an active area of research for us as we onboard new assets and pools. We are also considering using Chainlink oracles instead.

- **Upgradeability**

  We have removed Compound's CToken and Comptroller upgradeability. However, the admin can update the LP Vault contract address, and can also update the oracle used for a given asset.

# Resources
## Duality Links
- [Blog](https://mirror.xyz/0x426D702b3ECc4a2f50E575413f20642bbDB8965e)
- [Gitbook](https://dualitylabs.gitbook.io/duality/)
- [Website](https://www.dualityfi.xyz/)
- [Discord](discord.gg/nDRCdF6Bnc)
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
