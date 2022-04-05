import _ from "lodash";
import { ethers } from "hardhat";
import { assert, expect } from "chai";
import { constants, BigNumber } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import {
  USDC,
  WETH,
  WBTC,
  UNI_V3_NFP_MANAGER,
  USDC_WETH_v3_500,
  UNI_V3_ROUTER2,
  Chain,
  Token,
  UNI_V3_FACTORY,
} from "../shared/constants";
import { setupComptrollerAndLPVault, setupTokens } from "../shared/compound";
import { deployPriceOracle, deployTickOracle } from "../src";
import { giveERC20Balance, isSimilar, encodePath, resetChain } from "./utils";
import { getERC20Decimals } from "../shared/utils";
import { result as NFP_MANAGER_ABI } from "../shared/abis/NFP_MANAGER_ABI.json";
import { result as UNI_ROUTER2_ABI } from "../shared/abis/UNI_ROUTER2_ABI.json";

describe("compound fork tests", function () {
  before("reset chain", async function () {
    await resetChain();
  });

  before("setup accounts", async function () {
    const [deployer, user1, user2, user3, user4] = await ethers.getSigners();
    this.deployer = deployer;
    this.user1 = user1;
    this.user2 = user2;
    this.user3 = user3;
    this.user4 = user4;
  });

  before("setup oracles", async function () {
    // deploy LP price oracle
    this.oracle = await deployPriceOracle(this.deployer);
    this.wbtcPrice = 13.2625;
    this.wethPrice = 1;
    this.usdcPrice = 0.0005;
    await this.oracle
      .connect(this.deployer)
      .setDirectPrice(WBTC, parseUnits(this.wbtcPrice.toString(), 36 - getERC20Decimals(Token.WBTC)));
    await this.oracle.connect(this.deployer).setDirectPrice(WETH, parseUnits(this.wethPrice.toString(), 18));
    await this.oracle
      .connect(this.deployer)
      .setDirectPrice(USDC, parseUnits(this.usdcPrice.toString(), 36 - getERC20Decimals(Token.USDC)));

    this.tickOracle = await deployTickOracle(this.deployer, UNI_V3_NFP_MANAGER, UNI_V3_FACTORY);
    // what is the appropriate tick for the above price?
    await this.tickOracle.setTick(USDC_WETH_v3_500, "195983");
  });

  before("setup comptroller and lpVault", async function () {
    // this.comptroller, this.UniV3LpVault = await setupComptrollerAndLPVault(this.deployer, this.oracle);
    const results = await setupComptrollerAndLPVault(this.deployer, this.deployer.address, this.oracle);
    this.comptroller = results[0];
    this.UniV3LpVault = results[1];

    await this.comptroller._setSupportedPools([USDC_WETH_v3_500], [true]);
    await this.comptroller._setPoolCollateralFactors([USDC_WETH_v3_500], [parseUnits("0.8", 18)]);
    await this.comptroller._setTickOracle(this.tickOracle.address);
  });

  before("setup NFP Manager", async function () {
    this.nfpmContract = new ethers.Contract(UNI_V3_NFP_MANAGER, NFP_MANAGER_ABI);
  });

  before("setup uniRouter", async function () {
    this.uniRouter = new ethers.Contract(UNI_V3_ROUTER2, UNI_ROUTER2_ABI);
  });

  before("setup tokens", async function () {
    this.ERC20_INFO = await setupTokens(this.deployer, this.comptroller, Chain.Mainnet);

    this.zETH = this.ERC20_INFO[Token.WETH].cToken;
    this.zUSDC = this.ERC20_INFO[Token.USDC].cToken;
    this.zBTC = this.ERC20_INFO[Token.WBTC].cToken;

    this.ERC20_USDC = this.ERC20_INFO[Token.USDC].token;
    this.ERC20_WETH = this.ERC20_INFO[Token.WETH].token;
    this.ERC20_WBTC = this.ERC20_INFO[Token.WBTC].token;

    this.testedERCs = [this.ERC20_INFO[Token.WETH], this.ERC20_INFO[Token.USDC], this.ERC20_INFO[Token.WBTC]];

    const initialBalance: Record<string, string> = {
      [WETH]: "2000000000000",
      [WBTC]: "2000000000000",
      [USDC]: "20000000000000000",
    };
    for (const erc20 of this.testedERCs) {
      // Give admin assets to control on user behalf
      await giveERC20Balance(
        this.deployer.address,
        erc20.tokenEnum,
        erc20.token.address,
        parseUnits(initialBalance[erc20.token.address], erc20.decimals),
      );

      await giveERC20Balance(
        this.user1.address,
        erc20.tokenEnum,
        erc20.token.address,
        parseUnits(initialBalance[erc20.token.address], erc20.decimals),
      );

      await giveERC20Balance(
        this.user2.address,
        erc20.tokenEnum,
        erc20.token.address,
        parseUnits(initialBalance[erc20.token.address], erc20.decimals),
      );

      await giveERC20Balance(
        this.user3.address,
        erc20.tokenEnum,
        erc20.token.address,
        parseUnits(initialBalance[erc20.token.address], erc20.decimals),
      );

      await giveERC20Balance(
        this.user4.address,
        erc20.tokenEnum,
        erc20.token.address,
        parseUnits(initialBalance[erc20.token.address], erc20.decimals),
      );

      // Approve assets
      await erc20.token.connect(this.deployer).approve(erc20.cToken.address, constants.MaxUint256);
      await erc20.token.connect(this.user1).approve(erc20.cToken.address, constants.MaxUint256);
      await erc20.token.connect(this.user2).approve(erc20.cToken.address, constants.MaxUint256);
      await erc20.token.connect(this.user3).approve(erc20.cToken.address, constants.MaxUint256);
      await erc20.token.connect(this.user4).approve(erc20.cToken.address, constants.MaxUint256);

      await erc20.token.connect(this.deployer).approve(this.uniRouter.address, constants.MaxUint256);
      await erc20.token.connect(this.user3).approve(this.nfpmContract.address, constants.MaxUint256);
      await erc20.token.connect(this.user4).approve(this.nfpmContract.address, constants.MaxUint256);

      // provide some initial supply to the pool
      await erc20.cToken.connect(this.deployer).mintBehalf(this.deployer.address, parseUnits("200000", erc20.decimals));
    }
  });

  before("setup comptroller variables", async function () {
    this.liquidationIncentiveMantissa = await this.comptroller.liquidationIncentiveMantissa();
    this.closeFactorMantissa = await this.comptroller.closeFactorMantissa();
    this.collateralFactorUSDC = (await this.comptroller.markets(this.zUSDC.address)).collateralFactorMantissa;
    this.collateralFactorETH = (await this.comptroller.markets(this.zETH.address)).collateralFactorMantissa;
  });

  describe("only lpVault can take certain actions", async function () {
    it("anyone can mint for others", async function () {
      const amt = "1000";
      for (const erc20 of this.testedERCs) {
        erc20.cToken.mintBehalf(this.user1.address, parseUnits(amt, erc20.decimals));
      }
    });

    it("only admin can redeem for others", async function () {
      const amt = "1000";
      for (const erc20 of this.testedERCs) {
        await erc20.cToken.mintBehalf(this.user1.address, parseUnits(amt, erc20.decimals));

        const balance = await erc20.cToken.balanceOf(this.user1.address);

        await expect(erc20.cToken.connect(this.user2).redeemBehalf(this.user1.address, balance)).to.be.revertedWith(
          "only the LpVault may redeem other's assets",
        );
      }
    });

    it("only admin can borrow for others", async function () {
      await this.zETH.mintBehalf(this.user1.address, parseUnits("100", getERC20Decimals(Token.WETH)));
      await this.zUSDC.mintBehalf(this.user2.address, parseUnits("1000000", getERC20Decimals(Token.USDC)));

      await this.comptroller
        .connect(this.user1)
        .enterMarkets([this.zETH.address, this.zUSDC.address, this.zBTC.address]);

      const borrowAmt = "10";
      await expect(
        this.zUSDC
          .connect(this.user2)
          .borrowBehalf(this.user1.address, parseUnits(borrowAmt, getERC20Decimals(Token.USDC))),
      ).to.be.revertedWith("only the LpVault may borrow against other's collateral");
    });

    it("anyone can repay for others", async function () {
      // Users separately supply assets
      await this.zETH.mintBehalf(this.user1.address, parseUnits("1000", 18));
      await this.zBTC.mintBehalf(this.user2.address, parseUnits("100", getERC20Decimals(Token.WBTC)));

      await this.comptroller.connect(this.user2).enterMarkets([this.zETH.address, this.zBTC.address]);

      // User 2 borrows user 1's WETH tokens
      let borrowAmt = "50";
      let tx = await this.zETH
        .connect(this.user2)
        .borrowBehalf(this.user2.address, parseUnits(borrowAmt, getERC20Decimals(Token.WETH)));
      await tx.wait();

      // Check that user has a borrow balance
      let [_errorCodeBN, _cTokenBalance, borrowBalance, _exchangeRateMantissa] = await this.zETH.getAccountSnapshot(
        this.user2.address,
      );
      expect(borrowBalance).to.be.gt(BigNumber.from(0));

      // Repay full amount using "uint(-1)" i.e. 2^256-1
      const repayAmt = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      await this.zETH.connect(this.user2).repayBorrowBehalf(this.user1.address, repayAmt);
    });
  });

  it("mint on behalf", async function () {
    const amt = "1000";
    for (const erc20 of this.testedERCs) {
      const mintAmount = parseUnits(amt, erc20.decimals);
      await erc20.cToken.mintBehalf(this.user1.address, mintAmount);
      const balance = await erc20.cToken.balanceOf(this.user1.address);
      const exchangeRate = await erc20.cToken.exchangeRateStored();
      const mantissa = 18 + erc20.decimals - 8;
      const balanceUnderlying = balance.mul(exchangeRate).div(parseUnits("1", mantissa));
      expect(balanceUnderlying).to.equal(parseUnits(amt, 8));
    }
  });

  it("redeem on behalf of self", async function () {
    const amt = "1000";
    for (const erc20 of this.testedERCs) {
      await erc20.cToken.mintBehalf(this.user1.address, parseUnits(amt, erc20.decimals));

      const balance = await erc20.cToken.balanceOf(this.user1.address);

      await erc20.cToken.connect(this.user1).redeemBehalf(this.user1.address, balance);
      expect(await erc20.cToken.balanceOf(this.user1.address)).to.equal(BigNumber.from(0));
    }
  });

  const BORROW_TEST_CASES = [
    {
      description: "borrow WBTC against WETH",
      supplyAsset: Token.WETH,
      borrowAsset: Token.WBTC,
      collateralAmt: parseUnits("1000", 18),
      borrowAmt: parseUnits("100", getERC20Decimals(Token.WBTC)),
    },
    {
      description: "borrow WBTC against USDC",
      supplyAsset: Token.USDC,
      borrowAsset: Token.WBTC,
      collateralAmt: parseUnits("1000000", getERC20Decimals(Token.USDC)),
      borrowAmt: parseUnits("100", getERC20Decimals(Token.WBTC)),
    },
    {
      description: "borrow WETH against USDC",
      supplyAsset: Token.USDC,
      borrowAsset: Token.WETH,
      collateralAmt: parseUnits("1000000", getERC20Decimals(Token.USDC)),
      borrowAmt: parseUnits("100", 18),
    },
  ];

  describe("borrow on behalf of self", async function () {
    for (const testCase of BORROW_TEST_CASES) {
      it(testCase.description, async function () {
        const zSupply = this.ERC20_INFO[testCase.supplyAsset].cToken;
        const zBorrow = this.ERC20_INFO[testCase.borrowAsset].cToken;
        await zSupply.mintBehalf(this.user1.address, testCase.collateralAmt);
        await zBorrow.mintBehalf(this.user2.address, testCase.borrowAmt);

        await this.comptroller.connect(this.user1).enterMarkets([zSupply.address, zBorrow.address]);

        // Check that user has positive liquidity
        let [_errorCode, liquidity, _shortfall] = await this.comptroller.getAccountLiquidity(this.user1.address);
        expect(liquidity).to.be.gt(BigNumber.from(0));

        // Borrow
        let tx = await zBorrow.connect(this.user1).borrowBehalf(this.user1.address, testCase.borrowAmt);
        await tx.wait();

        // Check that user has a borrow balance
        let [_errorCodeBN, _cTokenBalance, borrowBalance, _exchangeRateMantissa] = await zBorrow.getAccountSnapshot(
          this.user1.address,
        );
        expect(borrowBalance).to.be.gt(BigNumber.from(0));
      });
    }
  });

  it("repay on behalf", async function () {
    // Users separately supply assets
    await this.zETH.mintBehalf(this.user1.address, parseUnits("1000", 18));
    await this.zBTC.mintBehalf(this.user2.address, parseUnits("100", getERC20Decimals(Token.WBTC)));

    await this.comptroller.connect(this.user2).enterMarkets([this.zETH.address, this.zBTC.address]);

    // User 2 borrows user 1's WETH tokens
    let borrowAmt = "25";

    let tx = await this.zETH.connect(this.user2).borrowBehalf(this.user2.address, parseUnits(borrowAmt, 18));
    await tx.wait();

    let [_errorCodeBN, _cTokenBalance, borrowBalance, _exchangeRateMantissa] = await this.zETH.getAccountSnapshot(
      this.user2.address,
    );
    expect(borrowBalance).to.be.gt(BigNumber.from(0));

    // Repay full amount using "uint(-1)" i.e. 2^256-1
    const repayAmt = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    tx = await this.zETH.repayBorrowBehalf(this.user2.address, repayAmt);
    await tx.wait();

    // Check that borrow was repaid
    [_errorCodeBN, _cTokenBalance, borrowBalance, _exchangeRateMantissa] = await this.zETH.getAccountSnapshot(
      this.user2.address,
    );
    expect(borrowBalance).to.be.eq(BigNumber.from(0));
  });

  it("has 0 liquidity or shortfall", async function () {
    // Check that user has no liquidity
    let [_errorCode, liquidity, _shortfall] = await this.comptroller.getAccountLiquidity(this.user3.address);
    expect(_errorCode).to.be.eq(BigNumber.from(0));
    expect(liquidity).to.be.eq(BigNumber.from(0));
    expect(_shortfall).to.be.eq(BigNumber.from(0));
  });

  describe("NFT functionality", function () {
    describe("NFT UX Functionality", function () {
      before("deposit NFT collateral", async function () {
        const blockNumber = await ethers.provider.getBlockNumber();

        let [_errorCode, liquidity, _shortfall] = await this.comptroller.getAccountLiquidity(this.user4.address);
        expect(liquidity).to.be.eq(BigNumber.from(0));

        const mintParams = {
          token0: USDC,
          token1: WETH,
          fee: 500,
          tickLower: -887220,
          tickUpper: 887220,
          amount0Desired: parseUnits("10000", 6).toString(),
          amount1Desired: parseEther("3").toString(),
          amount0Min: 1,
          amount1Min: 1,
          recipient: this.user4.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        };

        const tx2 = await this.nfpmContract.connect(this.user4).mint(mintParams);
        await tx2.wait();

        // get tokenId, assuming there aren't any previous NFTs
        this.tokenId = await this.nfpmContract.connect(this.user4).tokenOfOwnerByIndex(this.user4.address, 0);

        // then have user1 deposit the NFT V3 position
        const tx3 = await this.nfpmContract
          .connect(this.user4)
          ["safeTransferFrom(address,address,uint256)"](this.user4.address, this.UniV3LpVault.address, this.tokenId);
        await tx3.wait();
      });

      before("open some minimal debt", async function () {
        await this.comptroller.connect(this.user4).enterMarkets([this.zBTC.address]);

        // Check that user has positive liquidity
        let [_errorCode, liquidity, _shortfall] = await this.comptroller.getAccountLiquidity(this.user4.address);
        expect(liquidity).to.be.gt(BigNumber.from(0));

        // liquidity is in ETH mantissa
        // need borrowing amount equal to % of that

        // borrow a fifth of liquidity
        const borrowAmt = (0.2 * liquidity) / (this.wbtcPrice * 10 ** (18 - getERC20Decimals(Token.WBTC)));

        // Borrow
        const tx = await this.zBTC
          .connect(this.user4)
          .borrowBehalf(this.user4.address, Math.round(borrowAmt).toString());
        await tx.wait();

        // Check that user has a borrow balance
        const [_errorCodeBN, _cTokenBalance, borrowBalance, _exchangeRateMantissa] = await this.zBTC.getAccountSnapshot(
          this.user4.address,
        );
        expect(borrowBalance).to.be.gt(BigNumber.from(0));
      });

      it("properly increases liquidity using nonfungiblePositionManager", async function () {
        // increase liquidity, check that liquidity of position increased appropriately
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.nfpmContract.connect(this.user4).increaseLiquidity({
          tokenId: this.tokenId,
          amount0Desired: parseUnits("1", getERC20Decimals(Token.USDC)),
          amount1Desired: parseUnits("1", getERC20Decimals(Token.WETH)),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        const [, , , , , , , newLiquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        expect(newLiquidity).to.be.gt(liquidity);
      });

      it("properly decreases liquidity", async function () {
        // check that decrease liquidity properly works
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
          tokenId: this.tokenId,
          liquidity: liquidity.div(10),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        const [, , , , , , , newLiquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        expect(newLiquidity).to.be.lt(liquidity);
      });

      it("reverts on decrease liquidity when not owner", async function () {
        // check same as above but from diff account
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await expect(
          this.UniV3LpVault.connect(this.deployer).decreaseLiquidity({
            tokenId: this.tokenId,
            liquidity: liquidity.div(10),
            amount0Min: 0,
            amount1Min: 0,
            deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          }),
        ).to.be.revertedWith("sender must be owner of deposited tokenId");
      });

      // not too much risk of this happening other than through TWAP tracking error, since fees are still in the NFT
      // the corresponding revert case on collectFees is the main point to cover here
      xit("reverts on too large of decreased liquidity", async function () {
        // try to decrease when in shortfall
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await expect(
          this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
            tokenId: this.tokenId,
            liquidity: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          }),
        ).to.be.revertedWith("insufficient liquidity");
      });

      it("properly collects fees", async function () {
        // decrease liquidity, check that fees are in position. Then check that we can collect them
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
          tokenId: this.tokenId,
          liquidity: Math.round(0.1 * liquidity),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        const [, , , , , , , , , , firstFees0, firstFees1] = await this.nfpmContract
          .connect(this.user4)
          .positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).collectFees({
          tokenId: this.tokenId,
          recipient: this.user4.address,
          amount0Max: firstFees0,
          amount1Max: 0,
        });

        const [, , , , , , , , , , secondFees0, secondFees1] = await this.nfpmContract
          .connect(this.user4)
          .positions(this.tokenId);

        expect(secondFees0).to.be.eq(0);
        expect(secondFees1).to.be.eq(firstFees1);

        const tx = await this.UniV3LpVault.connect(this.user4).collectFees({
          tokenId: this.tokenId,
          recipient: this.user4.address,
          amount0Max: 0,
          amount1Max: Math.round(0.5 * firstFees1).toString(),
        });
        await tx.wait();

        const [, , , , , , , , , , thirdFees0, thirdFees1] = await this.nfpmContract
          .connect(this.user4)
          .positions(this.tokenId);

        expect(thirdFees0).to.be.eq(0);
        expect(isSimilar(thirdFees1.toString(), (0.5 * firstFees1).toString())).to.be.true;
      });

      it("reverts on collect fees when not owner", async function () {
        // try same as above except from another account
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
          tokenId: this.tokenId,
          liquidity: liquidity.div(10),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        const [, , , , , , , , , , fees0, fees1] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await expect(
          this.UniV3LpVault.connect(this.user2).collectFees({
            tokenId: this.tokenId,
            recipient: this.user2.address,
            amount0Max: fees0,
            amount1Max: fees1,
          }),
        ).to.be.revertedWith("sender must be owner of deposited tokenId");
      });

      it("reverts on too large of collect fees", async function () {
        // try to collect fees when in shortfall
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
          tokenId: this.tokenId,
          liquidity: liquidity.div(10),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        // need to enter shortfall here
        const newPrice = this.wbtcPrice * 10;
        await this.oracle
          .connect(this.deployer)
          .setDirectPrice(WBTC, parseUnits(newPrice.toString(), 36 - getERC20Decimals(Token.WBTC)));

        const [, , , , , , , , , , fees0, fees1] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await expect(
          this.UniV3LpVault.connect(this.user4).collectFees({
            tokenId: this.tokenId,
            recipient: this.user4.address,
            amount0Max: fees0,
            amount1Max: fees1,
          }),
        ).to.be.revertedWith("insufficient liquidity");

        await this.oracle
          .connect(this.deployer)
          .setDirectPrice(WBTC, parseUnits(this.wbtcPrice.toString(), 36 - getERC20Decimals(Token.WBTC)));
      });

      it("properly compounds fees", async function () {
        // increase liquidity, decrease it (to put funds into fees), then remove almost all of one side
        // do calculations for how much of each token it should deposit
        // verify that very small amount is returned
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
          tokenId: this.tokenId,
          liquidity: Math.round(0.1 * liquidity),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        // collect some fees to alter the balance
        await this.UniV3LpVault.connect(this.user4).collectFees({
          tokenId: this.tokenId,
          recipient: this.user4.address,
          amount0Max: amountToken0Fees,
          amount1Max: 0,
        });

        // need to calculate expected deposits :/ could do staticCall of swap to get price
        // can look at token0Liquidity and token1Liquidity for expected balance
        // static call on swap for current price
        const hypotheticalAmountOut = await this.uniRouter.connect(this.deployer).callStatic.exactInputSingle({
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseEther("1").toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

        // above is how much USDC we get for 1 ETH. from here can calculate how much expected we would get
        // so given 100% token1, an eth price of hypotheticalAmountOut, and a goal ratio of amountToken0Liquidity
        // solve

        // convert all token decimals to 18 until end
        const zValue = (amountToken1Liquidity * 1e6) / amountToken0Liquidity;
        const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e6;
        const expectedAmountLess1 = (amountToken1Fees * 1e18) / denom;
        const expectedAmount1 = amountToken1Fees - expectedAmountLess1;
        const expectedAmount0 = (expectedAmountLess1 * hypotheticalAmountOut) / 1e18;

        const balanceToken0Before = await this.ERC20_USDC.connect(this.user4).balanceOf(this.user4.address);
        const balanceToken1Before = await this.ERC20_WETH.connect(this.user4).balanceOf(this.user4.address);

        await this.UniV3LpVault.connect(this.user4).compoundFees({
          tokenId: this.tokenId,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
        });

        const balanceToken0After = await this.ERC20_USDC.connect(this.user4).balanceOf(this.user4.address);
        const balanceToken1After = await this.ERC20_WETH.connect(this.user4).balanceOf(this.user4.address);

        const amountTaken0 = expectedAmount0 - (balanceToken0After - balanceToken0Before);
        const amountTaken1 = expectedAmount1 - (balanceToken1After - balanceToken1Before);

        expect(isSimilar(amountTaken0.toString(), expectedAmount0.toString())).to.be.true;
        expect(isSimilar(amountTaken1.toString(), expectedAmount1.toString())).to.be.true;
      });

      it("reverts on compound fees when not owner", async function () {
        // call compound fees function from another account
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
          tokenId: this.tokenId,
          liquidity: liquidity.div(10),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        const [, , , , , , , , , , fees0, fees1] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await expect(
          this.UniV3LpVault.connect(this.user2).compoundFees({
            tokenId: this.tokenId,
            expectedAmount0: fees0,
            expectedAmount1: fees1,
            amount0Min: 0,
            amount1Min: 0,
          }),
        ).to.be.revertedWith("sender must be owner of deposited tokenId");
      });

      it("reverts on compound fees when not enough tokens are utilized", async function () {
        // set min too high on one of the tokens
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , , , , liquidity, , , ,] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await this.UniV3LpVault.connect(this.user4).decreaseLiquidity({
          tokenId: this.tokenId,
          liquidity: Math.round(0.1 * liquidity),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        });

        const [, , , , , , , , , , fees0, fees1] = await this.nfpmContract.connect(this.user4).positions(this.tokenId);

        await expect(
          this.UniV3LpVault.connect(this.user4).compoundFees({
            tokenId: this.tokenId,
            expectedAmount0: fees0,
            expectedAmount1: fees1,
            amount0Min: Math.round(fees0 * 1.01).toString(),
            amount1Min: 0,
          }),
        ).to.be.reverted;
      });

      it("properly moves range", async function () {
        // similar to compounds fees test, ensure that moving of range happens effectively (have to do calculations here)
        // ensure that new range exists, and that only small amount of funds are returned
        const blockNumber = await ethers.provider.getBlockNumber();

        const mintParams = {
          token0: USDC,
          token1: WETH,
          fee: 500,
          tickLower: -887220,
          tickUpper: 887220,
          amount0Desired: parseUnits("10000", 6).toString(),
          amount1Desired: parseEther("3").toString(),
          amount0Min: 1,
          amount1Min: 1,
          recipient: this.user4.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        };
        const tx = await this.nfpmContract.connect(this.user4).mint(mintParams);
        await tx.wait();

        // get tokenId, assuming 1 old tokenId
        const newTokenId = await this.nfpmContract.connect(this.user4).tokenOfOwnerByIndex(this.user4.address, 0);

        const tx2 = await this.nfpmContract
          .connect(this.user4)
          ["safeTransferFrom(address,address,uint256)"](this.user4.address, this.UniV3LpVault.address, newTokenId);
        await tx2.wait();

        const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.nfpmContract
          .connect(this.user4)
          .positions(newTokenId);

        const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const expectedAmount0 = amountToken0Fees + amountToken0Liquidity;
        const expectedAmount1 = amountToken1Fees + amountToken1Liquidity;

        await this.UniV3LpVault.connect(this.user4).moveRange({
          tokenId: newTokenId,
          liquidity: liquidity,
          newTickLower: Math.round(tickLower / 2).toString(),
          newTickUpper: Math.round(tickUpper / 2).toString(),
          expectedAmount0: expectedAmount0,
          expectedAmount1: expectedAmount1,
          amount0Min: 0,
          amount1Min: 0,
        });
        // since we moved full liquidity, expect this.tokenId to be burnt
        expect(this.nfpmContract.connect(this.user4).ownerOf(newTokenId)).to.be.revertedWith(
          "ERC721: owner query for nonexistent token",
        );

        const newNewTokenId = await this.UniV3LpVault.connect(this.user4).userTokens(this.user4.address, 1);
        await this.UniV3LpVault.connect(this.user4).withdrawToken(newNewTokenId, this.user4.address, []);
      });

      it("properly moves partial range", async function () {
        const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.nfpmContract
          .connect(this.user4)
          .positions(this.tokenId);

        const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const expectedAmount0 = amountToken0Fees + amountToken0Liquidity;
        const expectedAmount1 = amountToken1Fees + amountToken1Liquidity;

        await this.UniV3LpVault.connect(this.user4).moveRange({
          tokenId: this.tokenId,
          liquidity: Math.round(liquidity / 2).toString(),
          newTickLower: Math.round(tickLower / 2).toString(),
          newTickUpper: Math.round(tickUpper / 2).toString(),
          expectedAmount0: expectedAmount0,
          expectedAmount1: expectedAmount1,
          amount0Min: 0,
          amount1Min: 0,
        });

        const newTokenId = await this.UniV3LpVault.connect(this.user4).userTokens(this.user4.address, 0);

        await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);
        await this.tickOracle.getTokenBreakdownCurrent(newTokenId);
      });

      it("reverts on move range when not owner", async function () {
        // call move range when not owner
        const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.nfpmContract
          .connect(this.user4)
          .positions(this.tokenId);

        const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        await expect(
          this.UniV3LpVault.connect(this.user2).moveRange({
            tokenId: this.tokenId,
            liquidity: liquidity,
            newTickLower: Math.round(tickLower / 2).toString(),
            newTickUpper: Math.round(tickUpper / 2).toString(),
            expectedAmount0: amountToken0Fees + amountToken0Liquidity,
            expectedAmount1: amountToken1Fees + amountToken1Liquidity,
            amount0Min: 0,
            amount1Min: 0,
          }),
        ).to.be.revertedWith("sender must be owner of deposited tokenId");
      });

      it("reverts on move range when not enough tokens are utilized", async function () {
        // set min too high on one of the tokens
        const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.nfpmContract
          .connect(this.user4)
          .positions(this.tokenId);

        const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const amount0 = amountToken0Fees + amountToken0Liquidity;
        const amount1 = amountToken1Fees + amountToken1Liquidity;

        await expect(
          this.UniV3LpVault.connect(this.user4).moveRange({
            tokenId: this.tokenId,
            liquidity: liquidity,
            newTickLower: Math.round(tickLower / 2).toString(),
            newTickUpper: Math.round(tickUpper / 2).toString(),
            expectedAmount0: amount0,
            expectedAmount1: amount1,
            amount0Min: Math.round(amount0 * 1.01).toString(),
            amount1Min: Math.round(amount0 * 1.01).toString(),
          }),
        ).to.be.revertedWith("Price slippage check");
      });

      it("properly repays debt", async function () {
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const hypoAmountOutOne = await this.uniRouter.connect(this.deployer).callStatic.exactInputSingle({
          tokenIn: WETH,
          tokenOut: WBTC,
          fee: 3000,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseEther("1").toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

        const hypoAmountOutTwo = await this.uniRouter.connect(this.deployer).callStatic.exactInputSingle({
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseEther("1").toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

        const swapPath0 = encodePath([USDC, WETH, WBTC], [500, 3000]);
        const swapPath1 = encodePath([WETH, WBTC], [3000]);

        const e18 = BigNumber.from(10).pow(18);

        const [, , borrowBalance] = await this.zBTC.getAccountSnapshot(this.user4.address);

        const repayAmount = borrowBalance.div(5);
        const repayAmountInEth = repayAmount.mul(e18).div(hypoAmountOutOne);
        const token0InEth = amountToken0Liquidity.mul(e18).div(hypoAmountOutTwo);
        const valueLiquidity = amountToken1Liquidity.add(token0InEth);

        const liquidityBurnFactor = repayAmountInEth.mul(12).div(10).mul(e18).div(valueLiquidity);
        const liquidityBurnAmount = liquidityBurnFactor.mul(amountLiquidityBefore).div(e18);

        const amountDebtTokenUserBefore = await this.ERC20_WBTC.connect(this.user4).balanceOf(this.user4.address);
        const amountDebtTokenCTokenBefore = await this.ERC20_WBTC.connect(this.user4).balanceOf(this.zBTC.address);
        const amountDebtTokenVaultBefore = await this.ERC20_WBTC.connect(this.user4).balanceOf(
          this.UniV3LpVault.address,
        );

        // need real debt to repay

        await this.UniV3LpVault.connect(this.user4).repayDebt({
          tokenId: this.tokenId,
          liquidity: liquidityBurnAmount, // can move partial liquidity
          repayAmount: repayAmount,
          debtCToken: this.zBTC.address,
          underlying: WBTC,
          swapPath0: swapPath0, // swapPath through this pool, and WETH to WBTC
          swapPath1: swapPath1, // swapPath from WETH to WBTC
        });

        const [, , , , , , amountLiquidityAfter] = await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const amountDebtTokenUserAfter = await this.ERC20_WBTC.connect(this.user4).balanceOf(this.user4.address);
        const amountDebtTokenCTokenAfter = await this.ERC20_WBTC.connect(this.user4).balanceOf(this.zBTC.address);
        const amountDebtTokenVaultAfter = await this.ERC20_WBTC.connect(this.user4).balanceOf(
          this.UniV3LpVault.address,
        );

        const amountDebtTokenUserGained = amountDebtTokenUserAfter.sub(amountDebtTokenUserBefore);
        const amountDebtTokenCTokenGained = amountDebtTokenCTokenAfter.sub(amountDebtTokenCTokenBefore);
        const amountLiquidityReduced = amountLiquidityBefore.sub(amountLiquidityAfter);
        const amountVaultGained = amountDebtTokenVaultAfter.sub(amountDebtTokenVaultBefore);

        const expectedAmountDebtTokenUserGained = hypoAmountOutOne
          .mul(valueLiquidity)
          .mul(liquidityBurnFactor)
          .div(e18)
          .div(e18)
          .sub(repayAmount);

        expect(isSimilar(amountLiquidityReduced.toString(), liquidityBurnAmount.toString())).to.be.true;
        expect(isSimilar(amountDebtTokenCTokenGained.toString(), repayAmount.toString())).to.be.true;

        // TODO: get **4 precision
        expect(isSimilar(amountDebtTokenUserGained.toString(), expectedAmountDebtTokenUserGained.toString(), 2)).to.be
          .true;
        expect(amountVaultGained).to.eq(0);
      });

      it("reverts when other user tries to repay debt", async function () {
        const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const swapPath1 = encodePath([WETH, USDC], [500]);

        const liquidityBurnFactor = 0.15;

        const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
        const repayAmount = Math.round(0.1 * amountToken0Liquidity);

        await expect(
          this.UniV3LpVault.connect(this.user1).repayDebt({
            tokenId: this.tokenId,
            liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
            repayAmount: repayAmount.toString(),
            debtCToken: this.zUSDC.address,
            underlying: USDC,
            swapPath0: [], // don't need swapPath for USDC
            swapPath1: swapPath1, // swapPath can just be through this current pool
          }),
        ).to.be.revertedWith("sender must be owner of deposited tokenId");
      });

      // will have to test this on actual compound
      it("reverts when not enough debt was repayed", async function () {
        const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const liquidityBurnFactor = 0.1;

        const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
        const repayAmount = Math.round(0.5 * amountToken0Liquidity);

        await expect(
          this.UniV3LpVault.connect(this.user4).repayDebt({
            tokenId: this.tokenId,
            liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
            repayAmount: repayAmount.toString(),
            debtCToken: this.zUSDC.address,
            underlying: USDC,
            swapPath0: [], // don't need swapPath for USDC
            swapPath1: [], // swapPath can just be through this current pool
          }),
        ).to.be.revertedWith("not enough liquidity burned: Repay debt must repay repayAmount of debt");

        // TODO: should reword above: 'not enough liquidity burned: repayDebt must repay repayAmount of debt'
        // TODO: might be able to detect if repayAmount is larger than current debt
      });

      it("properly executes flashFocus", async function () {
        // need stubErc20 to have sufficient funds
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const hypotheticalAmountOut = await this.uniRouter.connect(this.deployer).callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
        const e30 = BigNumber.from(10).pow(30);
        const e18 = BigNumber.from(10).pow(18);
        const e6 = BigNumber.from(10).pow(6);

        const amountToken1In0 = amountToken1Liquidity.mul(e6).div(hypotheticalAmountOut);
        const amount = amountToken0Liquidity.add(amountToken1In0).mul(5).div(10);

        const zValue = amountToken0Liquidity.mul(e30).div(amountToken1Liquidity);
        const denom = zValue.mul(hypotheticalAmountOut).div(e18).add(e18);
        const expectedAmountLess0 = amount.mul(e18).div(denom);
        const expectedAmount0 = amount.sub(expectedAmountLess0);
        const expectedAmount1 = expectedAmountLess0.mul(hypotheticalAmountOut).div(e18);

        const balanceToken0Before = await this.ERC20_USDC.connect(this.user4).balanceOf(this.user4.address);
        const balanceToken1Before = await this.ERC20_WETH.connect(this.user4).balanceOf(this.user4.address);

        await this.UniV3LpVault.connect(this.user4).flashFocus({
          tokenId: this.tokenId,
          asset: USDC,
          amount: amount,
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: [],
        });

        const balanceToken0After = await this.ERC20_USDC.connect(this.user4).balanceOf(this.user4.address);
        const balanceToken1After = await this.ERC20_WETH.connect(this.user4).balanceOf(this.user4.address);

        const amountTaken0 = expectedAmount0 - (balanceToken0After - balanceToken0Before);
        const amountTaken1 = expectedAmount1 - (balanceToken1After - balanceToken1Before);

        expect(isSimilar(amountTaken0.toString(), expectedAmount0.toString())).to.be.true;
        expect(isSimilar(amountTaken1.toString(), expectedAmount1.toString())).to.be.true;
      });

      it("reverts when other user tries to flashFocus", async function () {
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const hypotheticalAmountOut = await this.uniRouter.connect(this.deployer).callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

        const e30 = BigNumber.from(10).pow(30);
        const e18 = BigNumber.from(10).pow(18);
        const e6 = BigNumber.from(10).pow(6);

        const amountToken1In0 = amountToken1Liquidity.mul(e6).div(hypotheticalAmountOut);
        const amount = amountToken0Liquidity.add(amountToken1In0).mul(5).div(10);

        const zValue = amountToken0Liquidity.mul(e30).div(amountToken1Liquidity);
        const denom = zValue.mul(hypotheticalAmountOut).div(e18).add(e18);
        const expectedAmountLess0 = amount.mul(e18).div(denom);
        const expectedAmount0 = amount.sub(expectedAmountLess0);
        const expectedAmount1 = expectedAmountLess0.mul(hypotheticalAmountOut).div(e18);

        await expect(
          this.UniV3LpVault.connect(this.user2).flashFocus({
            tokenId: this.tokenId,
            asset: USDC,
            amount: amount,
            premium: 0,
            expectedAmount0: Math.round(expectedAmount0).toString(),
            expectedAmount1: Math.round(expectedAmount1).toString(),
            amount0Min: 0,
            amount1Min: 0,
            swapPath: [],
          }),
        ).to.be.revertedWith("sender must be owner of deposited tokenId");
      });

      it("reverts when user tries to flashFocus too many funds", async function () {
        const blockNumber = await ethers.provider.getBlockNumber();

        const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        const hypotheticalAmountOut = await this.uniRouter.connect(this.deployer).callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

        const e30 = BigNumber.from(10).pow(30);
        const e18 = BigNumber.from(10).pow(18);
        const e6 = BigNumber.from(10).pow(6);

        const amountToken1In0 = amountToken1Liquidity.mul(e6).div(hypotheticalAmountOut);
        const amount = amountToken0Liquidity.add(amountToken1In0).mul(10);

        const zValue = amountToken0Liquidity.mul(e30).div(amountToken1Liquidity);
        const denom = zValue.mul(hypotheticalAmountOut).div(e18).add(e18);
        const expectedAmountLess0 = amount.mul(e18).div(denom);
        const expectedAmount0 = amount.sub(expectedAmountLess0);
        const expectedAmount1 = expectedAmountLess0.mul(hypotheticalAmountOut).div(e18);

        // try to flashFocus when we can't borrow anything
        await expect(
          this.UniV3LpVault.connect(this.user4).flashFocus({
            tokenId: this.tokenId,
            asset: USDC,
            amount: amount,
            premium: 0,
            expectedAmount0: Math.round(expectedAmount0).toString(),
            expectedAmount1: Math.round(expectedAmount1).toString(),
            amount0Min: 0,
            amount1Min: 0,
            swapPath: [],
          }),
        ).to.be.revertedWith("borrow failed");
      });
    });

    describe("Liquidation Functionality", function () {
      before("deposit NFT collateral", async function () {
        const blockNumber = await ethers.provider.getBlockNumber();

        const mintParams = {
          token0: USDC,
          token1: WETH,
          fee: 500,
          tickLower: -887220,
          tickUpper: 887220,
          amount0Desired: parseUnits("10000", 6).toString(),
          amount1Desired: parseEther("3").toString(),
          amount0Min: 1,
          amount1Min: 1,
          recipient: this.user3.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        };

        const tx2 = await this.nfpmContract.connect(this.user3).mint(mintParams);
        await tx2.wait();

        // get tokenId, assuming there aren't any previous NFTs
        this.tokenId = await this.nfpmContract.connect(this.user3).tokenOfOwnerByIndex(this.user3.address, 0);

        // then have user1 deposit the NFT V3 position
        const tx3 = await this.nfpmContract
          .connect(this.user3)
          ["safeTransferFrom(address,address,uint256)"](this.user3.address, this.UniV3LpVault.address, this.tokenId);
        await tx3.wait();
      });

      it("calculates the correct amount of liquidity", async function () {
        let [_errorCode, liquidity, _shortfall] = await this.comptroller.getAccountLiquidity(this.user3.address);
        expect(liquidity).to.be.gt(BigNumber.from(0));

        const collateralFactor =
          this.collateralFactorUSDC < this.collateralFactorETH ? this.collateralFactorUSDC : this.collateralFactorETH;

        const [
          token0Address,
          token1Address,
          amountToken0Fees,
          amountToken1Fees,
          amountToken0Liquidity,
          amountToken1Liquidity,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        assert(token0Address == USDC);
        assert(token1Address == WETH);

        // oracles already account for decimal differences
        const usdcValue = (amountToken0Fees + amountToken0Liquidity) * (await this.oracle.price(USDC));
        const wethValue = (amountToken1Fees + amountToken1Liquidity) * (await this.oracle.price(WETH));

        const totalValue = usdcValue + wethValue;
        const totalValueWithDiscount = (collateralFactor * totalValue) / 1e36;

        expect(isSimilar(totalValueWithDiscount.toString(), liquidity.toString())).to.be.true;
      });

      it("reverts when trying to seize too much", async function () {
        const [
          token0Address,
          token1Address,
          amountToken0Fees,
          amountToken1Fees,
          amountToken0Liquidity,
          amountToken1Liquidity,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        assert(token0Address == USDC);
        assert(token1Address == WETH);

        // oracles already account for decimal differences
        const usdcValue = (amountToken0Fees + amountToken0Liquidity) * (await this.oracle.price(USDC));
        const wethValue = (amountToken1Fees + amountToken1Liquidity) * (await this.oracle.price(WETH));

        const totalValue = usdcValue + wethValue;

        const totalValInUsdc = totalValue / (await this.oracle.price(USDC));

        const effectiveRepayAmount = 1.25 * totalValInUsdc;
        const actualRepayAmount = Math.round((effectiveRepayAmount / this.liquidationIncentiveMantissa) * 1e18);

        expect(
          this.comptroller.liquidateCalculateSeizeTokensUniV3(this.zUSDC.address, this.tokenId, actualRepayAmount),
        ).to.be.revertedWith("borrowValue greater than total collateral");
      });

      it("calculates correct seizeAmount when there are no fees", async function () {
        const [
          token0Address,
          token1Address,
          amountToken0Fees,
          amountToken1Fees,
          amountToken0Liquidity,
          amountToken1Liquidity,
          amountLiquidity,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        assert(token0Address == USDC);
        assert(token1Address == WETH);

        // oracles already account for decimal differences
        const usdcValue = (amountToken0Fees + amountToken0Liquidity) * (await this.oracle.price(USDC));
        const wethValue = (amountToken1Fees + amountToken1Liquidity) * (await this.oracle.price(WETH));

        const totalValue = usdcValue + wethValue;

        const totalValInUsdc = totalValue / (await this.oracle.price(USDC));

        const effectiveRepayAmount = 0.25 * totalValInUsdc;

        const actualRepayAmount = Math.round((effectiveRepayAmount / this.liquidationIncentiveMantissa) * 1e18);

        const [errorVal, seizedFeesToken0, seizedFeesToken1, seizedLiquidity] =
          await this.comptroller.liquidateCalculateSeizeTokensUniV3(
            this.zUSDC.address,
            this.tokenId,
            actualRepayAmount,
          );

        const expectedLiquidity = 0.25 * amountLiquidity;

        expect(seizedFeesToken0).to.be.eq(0);
        expect(seizedFeesToken1).to.be.eq(0);

        expect(isSimilar(expectedLiquidity.toString(), seizedLiquidity.toString())).to.be.true;
      });

      it("calculates correct seizeAmount when there are fees, seize some fees, no liquidity", async function () {
        const blockNumber = await ethers.provider.getBlockNumber();

        await this.uniRouter.connect(this.deployer).exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("5000000", 6).toString(),
          amountOutMinimum: parseEther("0.01").toString(),
          sqrtPriceLimitX96: 0,
        });

        await this.uniRouter.connect(this.deployer).exactInputSingle({
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseEther("2000").toString(),
          amountOutMinimum: parseUnits("1", 6).toString(),
          sqrtPriceLimitX96: 0,
        });

        const [token0Address, token1Address, amountToken0Fees, amountToken1Fees, , ,] = await this.tickOracle
          .connect(this.user2)
          .getTokenBreakdownTWAP(this.tokenId);

        assert(token0Address == USDC);
        assert(token1Address == WETH);

        // oracles already account for decimal differences
        const usdcValueFees = amountToken0Fees * (await this.oracle.price(USDC));
        const wethValueFees = amountToken1Fees * (await this.oracle.price(WETH));

        const totalValueFees = usdcValueFees + wethValueFees;

        const totalValInUsdc = totalValueFees / (await this.oracle.price(USDC));

        const effectiveRepayAmount = 0.65 * totalValInUsdc;

        const actualRepayAmount = Math.round((effectiveRepayAmount / this.liquidationIncentiveMantissa) * 1e18);

        const [errorVal, seizedFeesToken0, seizedFeesToken1, seizedLiquidity] =
          await this.comptroller.liquidateCalculateSeizeTokensUniV3(
            this.zUSDC.address,
            this.tokenId,
            actualRepayAmount,
          );

        const expectedSeizedFeesToken0 = 0.65 * amountToken0Fees;
        const expectedSeizedFeesToken1 = 0.65 * amountToken1Fees;

        expect(isSimilar(expectedSeizedFeesToken0.toString(), seizedFeesToken0.toString())).to.be.true;
        expect(isSimilar(expectedSeizedFeesToken1.toString(), seizedFeesToken1.toString())).to.be.true;

        expect(seizedLiquidity).to.be.eq(0);

        await this.UniV3LpVault.connect(this.user3).withdrawToken(this.tokenId, this.user3.address, []);

        await this.nfpmContract.connect(this.user3).collect({
          tokenId: this.tokenId,
          recipient: this.user3.address,
          amount0Max: BigNumber.from("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
          amount1Max: BigNumber.from("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
        });

        const tx = await this.nfpmContract
          .connect(this.user3)
          ["safeTransferFrom(address,address,uint256)"](this.user3.address, this.UniV3LpVault.address, this.tokenId);
        await tx.wait();
      });

      // test depends on previous test's trades
      it("calculates correct seizeAmount when there are fees, seize all fees, some liquidity", async function () {
        const blockNumber = await ethers.provider.getBlockNumber();

        await this.uniRouter.connect(this.deployer).exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("5000000", 6).toString(),
          amountOutMinimum: parseEther("0.01").toString(),
          sqrtPriceLimitX96: 0,
        });

        await this.uniRouter.connect(this.deployer).exactInputSingle({
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          recipient: this.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseEther("2000").toString(),
          amountOutMinimum: parseUnits("1", 6).toString(),
          sqrtPriceLimitX96: 0,
        });

        const [
          token0Address,
          token1Address,
          amountToken0Fees,
          amountToken1Fees,
          amountToken0Liquidity,
          amountToken1Liquidity,
          amountLiquidity,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        assert(token0Address == USDC);
        assert(token1Address == WETH);

        const usdcPrice = await this.oracle.price(USDC);
        const wethPrice = await this.oracle.price(WETH);

        // oracles already account for decimal differences
        const usdcValueFees = amountToken0Fees * usdcPrice;
        const usdcValueLiquidity = amountToken0Liquidity * usdcPrice;
        const wethValueFees = amountToken1Fees * wethPrice;
        const wethValueLiquidity = amountToken1Liquidity * wethPrice;

        const totalValueFees = usdcValueFees + wethValueFees;
        const totalValueLiquidity = usdcValueLiquidity + wethValueLiquidity;

        const totalValFeesInUsdc = totalValueFees / usdcPrice;
        const totalValLiquidityInUsdc = totalValueLiquidity / usdcPrice;

        const effectiveRepayAmount = totalValFeesInUsdc + 0.25 * totalValLiquidityInUsdc;

        const actualRepayAmount = Math.round((effectiveRepayAmount / this.liquidationIncentiveMantissa) * 1e18);

        const [errorVal, seizedFeesToken0, seizedFeesToken1, seizedLiquidity] =
          await this.comptroller.liquidateCalculateSeizeTokensUniV3(
            this.zUSDC.address,
            this.tokenId,
            actualRepayAmount,
          );

        const expectedSeizedFeesToken0 = amountToken0Fees;
        const expectedSeizedFeesToken1 = amountToken1Fees;
        const expectedLiquidity = 0.25 * amountLiquidity;

        expect(isSimilar(expectedSeizedFeesToken0.toString(), seizedFeesToken0.toString())).to.be.true;
        expect(isSimilar(expectedSeizedFeesToken1.toString(), seizedFeesToken1.toString())).to.be.true;
        expect(isSimilar(expectedLiquidity.toString(), seizedLiquidity.toString())).to.be.true;

        await this.UniV3LpVault.connect(this.user3).withdrawToken(this.tokenId, this.user3.address, []);

        await this.nfpmContract.connect(this.user3).collect({
          tokenId: this.tokenId,
          recipient: this.user3.address,
          amount0Max: BigNumber.from("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
          amount1Max: BigNumber.from("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
        });

        const tx = await this.nfpmContract
          .connect(this.user3)
          ["safeTransferFrom(address,address,uint256)"](this.user3.address, this.UniV3LpVault.address, this.tokenId);
        await tx.wait();
      });

      it("successfully performs end-to-end liquidation", async function () {
        // for testing end to end
        const collateralFactor =
          this.collateralFactorUSDC < this.collateralFactorETH ? this.collateralFactorUSDC : this.collateralFactorETH;

        const [
          token0Address,
          token1Address,
          amountToken0Fees,
          amountToken1Fees,
          amountToken0Liquidity,
          amountToken1Liquidity,
          amountLiquidity,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        // TODO: Need to ensure TWAP based calcuations are sensical, diffs from current are accounted for

        assert(token0Address == USDC);
        assert(token1Address == WETH);
        const e18 = BigNumber.from(10).pow(18);

        // oracles already account for decimal differences
        const usdcValueMantissa = amountToken0Fees.add(amountToken0Liquidity).mul(await this.oracle.price(USDC));
        const wethValueMantissa = amountToken1Fees.add(amountToken1Liquidity).mul(await this.oracle.price(WETH));

        const totalValueMantissa = usdcValueMantissa.add(wethValueMantissa);

        const totalValueWithDiscountMantissa = collateralFactor.mul(totalValueMantissa).div(e18);
        const totalValueWithDiscount = totalValueWithDiscountMantissa.div(e18);

        // using WBTC since moving its price does not affect the LP value
        const totalValInWBTC = totalValueWithDiscountMantissa.div(await this.oracle.price(WBTC));

        // borrow half of what could be borrowed
        const borrowAmount = totalValInWBTC.div(2);

        let [, liquidityFirst] = await this.comptroller.getAccountLiquidity(this.user3.address);

        expect(isSimilar(totalValueWithDiscount.toString(), liquidityFirst.toString())).to.be.true;

        // enter borrow market
        await this.comptroller.connect(this.user3).enterMarkets([this.zBTC.address]);

        // open borrow position
        let tx = await this.zBTC.connect(this.user3).borrowBehalf(this.user3.address, borrowAmount);
        await tx.wait();

        // move price such that collateral factor is breached
        const newPrice = this.wbtcPrice * 2.04;

        // slightly more than double price of debt to put us into shortfall
        await this.oracle
          .connect(this.deployer)
          .setDirectPrice(WBTC, parseUnits(newPrice.toString(), 36 - getERC20Decimals(Token.WBTC)));

        const expectedShortfall = borrowAmount
          .mul(await this.oracle.price(WBTC))
          .sub(totalValueWithDiscountMantissa)
          .div(e18);

        let [, liquiditySecond, shortfall] = await this.comptroller.getAccountLiquidity(this.user3.address);
        expect(liquiditySecond).to.be.eq(0);
        expect(shortfall).to.be.gt(0);
        expect(isSimilar(expectedShortfall.toString(), shortfall.toString())).to.be.true;

        const repayAmount = this.closeFactorMantissa.mul(borrowAmount).div(e18).div(3);

        // liquidate
        await this.zBTC.connect(this.user1).liquidateBorrowUniV3(this.user3.address, repayAmount, this.tokenId);

        const [
          ,
          ,
          amountToken0FeesAfter,
          amountToken1FeesAfter,
          amountToken0LiquidityAfter,
          amountToken1LiquidityAfter,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        const usdcValueMantissaAfter = amountToken0FeesAfter
          .add(amountToken0LiquidityAfter)
          .mul(await this.oracle.price(USDC));
        const wethValueMantissaAfter = amountToken1FeesAfter
          .add(amountToken1LiquidityAfter)
          .mul(await this.oracle.price(WETH));

        const totalValueMantissaAfter = usdcValueMantissaAfter.add(wethValueMantissaAfter);

        const valueLiquidatedMantissa = this.liquidationIncentiveMantissa
          .mul(repayAmount)
          .mul(await this.oracle.price(WBTC))
          .div(e18);

        const expectedTotalValueMantissaAfter = totalValueMantissa.sub(valueLiquidatedMantissa);

        expect(isSimilar(expectedTotalValueMantissaAfter.toString(), totalValueMantissaAfter.toString())).to.be.true;

        await this.oracle.setDirectPrice(
          WBTC,
          parseUnits(this.wbtcPrice.toString(), 36 - getERC20Decimals(Token.WBTC)),
        );

        let [, , borrowBalance] = await this.zBTC.getAccountSnapshot(this.user3.address);

        await this.zBTC.connect(this.deployer).repayBorrowBehalf(this.user3.address, borrowBalance);
      });

      it("fails opaquely when closing more than closeFactor% debt", async function () {
        const collateralFactor =
          this.collateralFactorUSDC < this.collateralFactorETH ? this.collateralFactorUSDC : this.collateralFactorETH;

        const [
          token0Address,
          token1Address,
          amountToken0Fees,
          amountToken1Fees,
          amountToken0Liquidity,
          amountToken1Liquidity,
          amountLiquidity,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        // TODO: Need to ensure TWAP based calcuations are sensical, diffs from current are accounted for

        assert(token0Address == USDC);
        assert(token1Address == WETH);

        // oracles already account for decimal differences
        const usdcValueMantissa = (amountToken0Fees + amountToken0Liquidity) * (await this.oracle.price(USDC));
        const wethValueMantissa = (amountToken1Fees + amountToken1Liquidity) * (await this.oracle.price(WETH));

        const totalValueMantissa = usdcValueMantissa + wethValueMantissa;

        const totalValueWithDiscountMantissa = (collateralFactor * totalValueMantissa) / 1e18;
        const totalValueWithDiscount = totalValueWithDiscountMantissa / 1e18;

        // using WBTC since moving its price does not affect the LP value
        const totalValInWBTC = totalValueWithDiscountMantissa / (await this.oracle.price(WBTC));

        // borrow half of what could be borrowed
        const borrowAmount = Math.round(totalValInWBTC / 2);

        let [, liquidityFirst] = await this.comptroller.getAccountLiquidity(this.user3.address);

        expect(isSimilar(totalValueWithDiscount.toString(), liquidityFirst.toString())).to.be.true;

        // enter borrow market
        await this.comptroller.connect(this.user3).enterMarkets([this.zBTC.address]);

        // open borrow position
        let tx = await this.zBTC.connect(this.user3).borrowBehalf(this.user3.address, borrowAmount);
        await tx.wait();

        // move price such that collateral factor is breached
        const newPrice = this.wbtcPrice * 2.04;

        // slightly more than double price of debt to put us into shortfall
        await this.oracle
          .connect(this.deployer)
          .setDirectPrice(WBTC, parseUnits(newPrice.toString(), 36 - getERC20Decimals(Token.WBTC)));

        const expectedShortfall =
          (borrowAmount * (await this.oracle.price(WBTC)) - totalValueWithDiscountMantissa) / 1e18;

        let [, liquiditySecond, shortfall] = await this.comptroller.getAccountLiquidity(this.user3.address);
        expect(liquiditySecond).to.be.eq(0);
        expect(shortfall).to.be.gt(0);
        expect(isSimilar(expectedShortfall.toString(), shortfall.toString())).to.be.true;

        const repayAmount = Math.round(((this.closeFactorMantissa * borrowAmount) / 1e18) * 1.05);

        // liquidate
        await this.zBTC.connect(this.user1).liquidateBorrowUniV3(this.user3.address, repayAmount, this.tokenId);

        const [
          ,
          ,
          amountToken0FeesAfter,
          amountToken1FeesAfter,
          amountToken0LiquidityAfter,
          amountToken1LiquidityAfter,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        const usdcValueMantissaAfter =
          (amountToken0FeesAfter + amountToken0LiquidityAfter) * (await this.oracle.price(USDC));
        const wethValueMantissaAfter =
          (amountToken1FeesAfter + amountToken1LiquidityAfter) * (await this.oracle.price(WETH));

        const totalValueMantissaAfter = usdcValueMantissaAfter + wethValueMantissaAfter;

        expect(totalValueMantissa).to.be.eq(totalValueMantissaAfter);

        await this.oracle.setDirectPrice(
          WBTC,
          parseUnits(this.wbtcPrice.toString(), 36 - getERC20Decimals(Token.WBTC)),
        );

        let [, , borrowBalance] = await this.zBTC.getAccountSnapshot(this.user3.address);

        await this.zBTC.connect(this.deployer).repayBorrowBehalf(this.user3.address, borrowBalance);
      });

      // TODO: what happens in compound when this happens? can you close a position that is actually underwater?
      it("reverts when LP value < debt value", async function () {
        const collateralFactor =
          this.collateralFactorUSDC < this.collateralFactorETH ? this.collateralFactorUSDC : this.collateralFactorETH;

        const [
          token0Address,
          token1Address,
          amountToken0Fees,
          amountToken1Fees,
          amountToken0Liquidity,
          amountToken1Liquidity,
          amountLiquidity,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        // TODO: Need to ensure TWAP based calcuations are sensical, diffs from current are accounted for

        assert(token0Address == USDC);
        assert(token1Address == WETH);

        // oracles already account for decimal differences
        const usdcValueMantissa = (amountToken0Fees + amountToken0Liquidity) * (await this.oracle.price(USDC));
        const wethValueMantissa = (amountToken1Fees + amountToken1Liquidity) * (await this.oracle.price(WETH));

        const totalValueMantissa = usdcValueMantissa + wethValueMantissa;

        const totalValueWithDiscountMantissa = (collateralFactor * totalValueMantissa) / 1e18;
        const totalValueWithDiscount = totalValueWithDiscountMantissa / 1e18;

        // using WBTC since moving its price does not affect the LP value
        const totalValInWBTC = totalValueWithDiscountMantissa / (await this.oracle.price(WBTC));

        // borrow half of what could be borrowed
        const borrowAmount = Math.round(totalValInWBTC / 2);

        let [, liquidityFirst] = await this.comptroller.getAccountLiquidity(this.user3.address);

        expect(isSimilar(totalValueWithDiscount.toString(), liquidityFirst.toString())).to.be.true;

        // enter borrow market
        await this.comptroller.connect(this.user3).enterMarkets([this.zBTC.address]);

        // open borrow position
        let tx = await this.zBTC.connect(this.user3).borrowBehalf(this.user3.address, borrowAmount);
        await tx.wait();

        // move price such that debt is > collateral value
        const newPrice = (this.wbtcPrice * 5 * 1e18) / collateralFactor;

        // slightly more than double price of debt to put us into shortfall
        await this.oracle
          .connect(this.deployer)
          .setDirectPrice(WBTC, parseUnits(newPrice.toString(), 36 - getERC20Decimals(Token.WBTC)));

        const expectedShortfall =
          (borrowAmount * (await this.oracle.price(WBTC)) - totalValueWithDiscountMantissa) / 1e18;

        let [, liquiditySecond, shortfall] = await this.comptroller.getAccountLiquidity(this.user3.address);
        expect(liquiditySecond).to.be.eq(0);
        expect(shortfall).to.be.gt(0);
        expect(isSimilar(expectedShortfall.toString(), shortfall.toString())).to.be.true;

        // just under close factor
        const repayAmount = Math.round((this.closeFactorMantissa * borrowAmount) / 1e18 / 1.02);

        // liquidate
        expect(
          this.zBTC.connect(this.user1).liquidateBorrowUniV3(this.user3.address, repayAmount, this.tokenId),
        ).to.be.revertedWith("borrowValue greater than total collateral");
        // TODO: consider rewording above error message

        const [
          ,
          ,
          amountToken0FeesAfter,
          amountToken1FeesAfter,
          amountToken0LiquidityAfter,
          amountToken1LiquidityAfter,
        ] = await this.tickOracle.connect(this.user2).getTokenBreakdownTWAP(this.tokenId);

        const usdcValueMantissaAfter =
          (amountToken0FeesAfter + amountToken0LiquidityAfter) * (await this.oracle.price(USDC));
        const wethValueMantissaAfter =
          (amountToken1FeesAfter + amountToken1LiquidityAfter) * (await this.oracle.price(WETH));

        const totalValueMantissaAfter = usdcValueMantissaAfter + wethValueMantissaAfter;

        expect(totalValueMantissa).to.be.eq(totalValueMantissaAfter);

        await this.oracle.setDirectPrice(
          WBTC,
          parseUnits(this.wbtcPrice.toString(), 36 - getERC20Decimals(Token.WBTC)),
        );
        let [, , borrowBalance] = await this.zBTC.getAccountSnapshot(this.user3.address);

        await this.zBTC.connect(this.deployer).repayBorrowBehalf(this.user3.address, borrowBalance);
      });
    });
  });
});
