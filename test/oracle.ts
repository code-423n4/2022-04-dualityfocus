import _ from "lodash";
import { ethers, artifacts } from "hardhat";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { expect } from "chai";
import {
  ZERO_ADDRESS,
  USDC,
  WETH,
  WBTC,
  USDC_WETH_v3_500,
  WBTC_WETH_v3_3000,
  cUSDC,
  UNI_V3_NFP_MANAGER,
  Token,
} from "../shared/constants";
import { abi as ERC20_ABI } from "../shared/abis/ERC20.json";
import { setupOracles, setupUniTwapOracle } from "./setup";
import { Artifact } from "hardhat/types";
import { mintFullRangeUsdcWeth } from "./helpers";
import { giveERC20Balance, resetChain } from "./utils";
import { constants } from "ethers";

describe("oracles", function () {
  before("setup price oracle", async function () {
    await resetChain();
    [this.deployer, this.user1] = await ethers.getSigners();
    this.twapPeriod = 60;
    const oracles = await setupOracles(this.deployer, this.twapPeriod, true);
    this.masterOracle = oracles[0];
    this.tickOracle = oracles[1];

    const nfpManagerArtifact: Artifact = await artifacts.readArtifact("INonfungiblePositionManager");
    const nfpmContract = new ethers.Contract(UNI_V3_NFP_MANAGER, nfpManagerArtifact.abi);
    const blockNumber = await ethers.provider.getBlockNumber();

    const ERC20_USDC = new ethers.Contract(USDC, ERC20_ABI);
    const ERC20_WETH = new ethers.Contract(WETH, ERC20_ABI);
    const ERC20_WBTC = new ethers.Contract(WBTC, ERC20_ABI);

    await giveERC20Balance(this.user1.address, Token.USDC, ERC20_USDC.address, parseUnits("10000000", 6));
    await giveERC20Balance(this.user1.address, Token.WETH, ERC20_WETH.address, parseEther("20000"));
    await ERC20_USDC.connect(this.user1).approve(nfpmContract.address, constants.MaxUint256);
    await ERC20_WETH.connect(this.user1).approve(nfpmContract.address, constants.MaxUint256);

    const amount0Desired = parseUnits("10000", 6).toString();
    const amount1Desired = parseEther("3").toString();

    await mintFullRangeUsdcWeth(this.user1, nfpmContract, blockNumber, amount0Desired, amount1Desired);

    // get tokenId, assuming there aren't any previous NFTs
    this.tokenId = await nfpmContract.connect(this.user1).tokenOfOwnerByIndex(this.user1.address, 0);
  });

  it("returns a price for all tokens", async function () {
    expect(await this.masterOracle.price(USDC)).to.be.gt(0);
    expect(await this.masterOracle.price(WETH)).to.be.eq(parseUnits("1", 18));
  });

  describe("TWAP oracle", function () {
    describe("getters", function () {
      // get admin
      it("gets admin", async function () {
        const admin = await this.tickOracle.admin();
        expect(admin).to.equal(this.deployer.address);
      });

      // get canAdminOverwrite
      it("gets canAdminOverwrite", async function () {
        const canAdminOverwrite = await this.tickOracle.canAdminOverwrite();
        expect(canAdminOverwrite).to.equal(true);
      });

      // get twapPeriod
      it("gets twapPeriod", async function () {
        const twapPeriod = await this.tickOracle.twapPeriod();
        expect(twapPeriod).to.equal(this.twapPeriod);
      });

      // get from referencePools
      it("gets from referencePools", async function () {
        const referencePool = await this.tickOracle.referencePools(USDC);
        expect(referencePool).to.equal(USDC_WETH_v3_500);
      });

      // get from isSupportedPool
      it("gets from isSupportedPool", async function () {
        const isSupportedPool = await this.tickOracle.isSupportedPool(USDC_WETH_v3_500);
        expect(isSupportedPool).to.be.true;
      });

      // get from price
      it("gets price", async function () {
        const price = await this.tickOracle.price(USDC);
        expect(price).to.be.gt(0);
      });

      // get from underlyingPrice
      it("gets underlyingPrice", async function () {
        const underlyingPrice = await this.tickOracle.getUnderlyingPrice(cUSDC);
        expect(underlyingPrice).to.be.gt(0);
      });

      // get from getTick
      it("gets getTick", async function () {
        const currentTick = await this.tickOracle.getTick(USDC_WETH_v3_500);
        expect(currentTick).to.be.gt(0);
      });

      it("gets tokenBreakdownTWAP", async function () {
        const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, amountLiquidity] =
          await this.tickOracle.getTokenBreakdownTWAP(this.tokenId);

        expect(amountToken0Fees).to.be.equal(0);
        expect(amountToken1Fees).to.be.equal(0);

        expect(amountToken0Liquidity).to.be.gt(0);
        expect(amountToken1Liquidity).to.be.gt(0);
        expect(amountLiquidity).to.be.gt(0);
      });

      it("gets tokenBreakdownCurrent", async function () {
        const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, amountLiquidity] =
          await this.tickOracle.getTokenBreakdownCurrent(this.tokenId);

        expect(amountToken0Fees).to.be.equal(0);
        expect(amountToken1Fees).to.be.equal(0);

        expect(amountToken0Liquidity).to.be.gt(0);
        expect(amountToken1Liquidity).to.be.gt(0);
        expect(amountLiquidity).to.be.gt(0);
      });
    });

    describe("modifiers", async function () {
      // call addAssets as admin and check that everything works as expected
      it("adds assets correctly", async function () {
        // list of tokens and list of pools
        const oracle = await setupUniTwapOracle(this.deployer, this.twapPeriod, false);

        await oracle.connect(this.deployer).addAssets([WBTC], [WBTC_WETH_v3_3000]);
        const price = await oracle.price(WBTC);
        expect(price).to.be.gt(0);

        const isSupportedPool = await oracle.isSupportedPool(WBTC_WETH_v3_3000);
        expect(isSupportedPool).to.be.true;
      });

      // test canAdminOverwrite
      it("respects canAdminOverwrite false", async function () {
        const oracle = await setupUniTwapOracle(this.deployer, this.twapPeriod, false);

        await oracle.connect(this.deployer).addAssets([WBTC], [WBTC_WETH_v3_3000]);
        const price = await oracle.price(WBTC);
        expect(price).to.be.gt(0);

        const isSupportedPool = await oracle.isSupportedPool(WBTC_WETH_v3_3000);
        expect(isSupportedPool).to.be.true;

        expect(oracle.connect(this.deployer).addAssets([WBTC], [ZERO_ADDRESS])).to.be.reverted;
      });

      // call addAssets and overwrite with 0 address
      //     make sure old pool is removed from supportedPools and 0 address is still not supported
      it("respects canAdminOverwrite true", async function () {
        const oracle = await setupUniTwapOracle(this.deployer, this.twapPeriod, true);

        const isSupportedPool1 = await oracle.isSupportedPool(WBTC_WETH_v3_3000);
        expect(isSupportedPool1).to.be.false;

        await oracle.connect(this.deployer).addAssets([WBTC], [WBTC_WETH_v3_3000]);
        const price = await oracle.price(WBTC);
        expect(price).to.be.gt(0);

        const isSupportedPool2 = await oracle.isSupportedPool(WBTC_WETH_v3_3000);
        expect(isSupportedPool2).to.be.true;

        await oracle.connect(this.deployer).addAssets([WBTC], [ZERO_ADDRESS]);

        const isSupportedPool3 = await oracle.isSupportedPool(WBTC_WETH_v3_3000);
        expect(isSupportedPool3).to.be.false;
      });
    });
  });
});
