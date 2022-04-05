import _ from "lodash";
import { artifacts, ethers, network, config, waffle } from "hardhat";
import { constants, BigNumber, Contract, Signer } from "ethers";
import { expect } from "chai";
import {
  USDC,
  WETH,
  USDC_WETH_v3_500,
  UNI_V3_FACTORY,
  UNI_V3_NFP_MANAGER,
  ZERO_ADDRESS,
  UNI_V3_ROUTER1,
  Token,
  WBTC,
  DAI,
} from "../shared/constants";
import {
  setupComptrollerStub,
  setupCErc20Stub,
  setupLpVault,
  setupOracles,
  setupVaultFlashLoanReceiver,
} from "./setup";
import { giveERC20Balance, isSimilar, encodePath, resetChain } from "./utils";
import { getERC20Decimals } from "../shared/utils";
import { parseEther, parseUnits, id } from "ethers/lib/utils";
import { Artifact } from "hardhat/types";
import { abi as ERC20_ABI } from "../shared/abis/ERC20.json";
import { result as UNI_ROUTER1_ABI } from "../shared/abis/UNI_ROUTER1_ABI.json";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { mintFullRangeUsdcWeth, sendNFT } from "./helpers";

const testSetup = async () => {
  await resetChain();
  const [deployer, user1, user2] = await ethers.getSigners();
  const twapPeriod = 60;
  const oracles = await setupOracles(deployer, twapPeriod, true);
  const masterOracle = oracles[0];
  const tickOracle = oracles[1];

  // const uniRouterArtifact = await artifacts.readArtifact("SwapRouter");
  // uniRouter = await waffle.deployContract(deployer, uniRouterArtifact, [UNI_V3_FACTORY, WETH]);
  const uniRouter = new ethers.Contract(UNI_V3_ROUTER1, UNI_ROUTER1_ABI);

  const nfpManagerArtifact: Artifact = await artifacts.readArtifact("INonfungiblePositionManager");
  const nfpmContract = new ethers.Contract(UNI_V3_NFP_MANAGER, nfpManagerArtifact.abi);

  const comptrollerStub = await setupComptrollerStub(deployer);
  const cUSDCStub = await setupCErc20Stub(deployer, USDC);
  const cWBTCStub = await setupCErc20Stub(deployer, WBTC);
  const cDAIStub = await setupCErc20Stub(deployer, DAI);
  const uniV3LpVault = await setupLpVault(deployer, comptrollerStub);
  const flashLoanReceiver = await setupVaultFlashLoanReceiver(deployer, uniV3LpVault.address);

  await expect(uniV3LpVault._setFlashLoan(flashLoanReceiver.address)).to.emit(uniV3LpVault, "NewFlashLoanContract");
  await comptrollerStub.setMarket(cUSDCStub.address, true);
  await comptrollerStub.setMarket(cWBTCStub.address, true);
  await comptrollerStub.setCTokenByUnderlying(cUSDCStub.address, USDC);
  await comptrollerStub.setCTokenByUnderlying(cWBTCStub.address, WBTC);
  await comptrollerStub.setIsSupportedPool(USDC_WETH_v3_500, true);
  await comptrollerStub.setOracle(masterOracle.address);
  await comptrollerStub.setTickOracle(tickOracle.address);
  await comptrollerStub.setIsLiquid(true);
  await comptrollerStub.setSeizeAllowed(true);
  await cUSDCStub.setIsLiquid(true);
  await cUSDCStub.setRepaySuccess(true);
  await cWBTCStub.setIsLiquid(true);
  await cWBTCStub.setRepaySuccess(true);

  const ERC20_USDC = new ethers.Contract(USDC, ERC20_ABI);
  const ERC20_WETH = new ethers.Contract(WETH, ERC20_ABI);
  const ERC20_WBTC = new ethers.Contract(WBTC, ERC20_ABI);

  for (const user of [deployer, user1, user2]) {
    await giveERC20Balance(user.address, Token.USDC, ERC20_USDC.address, parseUnits("10000000", 6));
    await giveERC20Balance(user.address, Token.WETH, ERC20_WETH.address, parseEther("20000"));
    await ERC20_USDC.connect(user).approve(nfpmContract.address, constants.MaxUint256);
    await ERC20_WETH.connect(user).approve(nfpmContract.address, constants.MaxUint256);
  }

  await giveERC20Balance(cUSDCStub.address, Token.USDC, ERC20_USDC.address, parseUnits("100000000", 6));
  await giveERC20Balance(cWBTCStub.address, Token.WBTC, ERC20_WBTC.address, parseUnits("100000", 8));

  await giveERC20Balance(deployer.address, Token.WBTC, ERC20_WBTC.address, parseUnits("10000", 8));

  await ERC20_USDC.connect(deployer).approve(uniRouter.address, constants.MaxUint256);
  await ERC20_WETH.connect(deployer).approve(uniRouter.address, constants.MaxUint256);
  await ERC20_WBTC.connect(deployer).approve(uniRouter.address, constants.MaxUint256);

  const blockNumber = await ethers.provider.getBlockNumber();

  const amount0Before = await ERC20_USDC.connect(user1).balanceOf(user1.address);
  const amount1Before = await ERC20_WETH.connect(user1).balanceOf(user1.address);

  const amount0Desired = parseUnits("10000", 6).toString();
  const amount1Desired = parseEther("3").toString();
  await mintFullRangeUsdcWeth(user1, nfpmContract, blockNumber, amount0Desired, amount1Desired);

  const amount0After = await ERC20_USDC.connect(user1).balanceOf(user1.address);
  const amount1After = await ERC20_WETH.connect(user1).balanceOf(user1.address);

  const amount0 = amount0Before - amount0After;
  const amount1 = amount1Before - amount1After;

  // get tokenId, assuming there aren't any previous NFTs
  const tokenId = await nfpmContract.connect(user1).tokenOfOwnerByIndex(user1.address, 0);
  // have user1 deposit the NFT position
  await sendNFT(nfpmContract, user1, uniV3LpVault.address, tokenId);

  return {
    deployer,
    user1,
    user2,
    ERC20_USDC,
    ERC20_WETH,
    comptrollerStub,
    cUSDCStub,
    cWBTCStub,
    cDAIStub,
    uniV3LpVault,
    flashLoanReceiver,
    uniRouter,
    masterOracle,
    tickOracle,
    nfpmContract,
    amount0,
    amount1,
    tokenId,
  };
};

describe("UniV3LPVault", function () {
  before("setup Lp Vault", async function () {
    //@ts-ignore
    this.results = await testSetup();
  });

  describe("getters", function () {
    // factory
    it("gets factory", async function () {
      const factory = await this.results.uniV3LpVault.factory();
      expect(factory).to.be.equal(UNI_V3_FACTORY);
    });

    // nonfungiblepositionmanager
    it("gets nonfungiblepositionmanager", async function () {
      const nonfungiblePositionManager = await this.results.uniV3LpVault.nonfungiblePositionManager();
      expect(nonfungiblePositionManager).to.be.equal(this.results.nfpmContract.address);
    });

    it("gets swapRouter", async function () {
      const swapRouter = await this.results.uniV3LpVault.swapRouter();
      expect(swapRouter).to.be.equal(this.results.uniRouter.address);
    });

    // comptroller
    it("gets comptroller", async function () {
      const comptroller = await this.results.uniV3LpVault.comptroller();
      expect(comptroller).to.be.equal(this.results.comptrollerStub.address);
    });

    // test getting deposits directly
    it("gets deposits", async function () {
      const owner = await this.results.uniV3LpVault.ownerOf(this.results.tokenId);
      expect(owner).to.be.equal(this.results.user1.address);
    });

    // test getting userTokens directly
    it("gets userTokens", async function () {
      const userToken = await this.results.uniV3LpVault.userTokens(this.results.user1.address, 0);
      expect(userToken).to.be.equal(this.results.tokenId);
    });

    // userTokensMax
    it("gets userTokensMax", async function () {
      await this.results.uniV3LpVault.userTokensMax();
    });

    it("gets userTokensLength", async function () {
      const length = await this.results.uniV3LpVault.getUserTokensLength(this.results.user1.address);
      expect(length).to.eq(1);
    });
  });

  describe("modifiers", function () {
    let dummyNftContract;
    before("setup dummyNFT", async function () {
      const dummyNftArtifact: Artifact = await artifacts.readArtifact("DummyNFT");
      dummyNftContract = await waffle.deployContract(this.results.deployer, dummyNftArtifact, ["dummyNFT", "duNFT"]);
    });

    it("allows only proper privileges to change deposit pause state", async function () {
      expect(this.results.uniV3LpVault.connect(this.results.user1)._pauseDeposits(true)).to.be.revertedWith(
        "only pause guardian and admin can pause",
      );
      await this.results.comptrollerStub.setPauseGuardian(this.results.user1.address);
      await this.results.uniV3LpVault.connect(this.results.user1)._pauseDeposits(true);
      expect(this.results.uniV3LpVault.connect(this.results.user1)._pauseDeposits(false)).to.be.revertedWith(
        "only admin can unpause",
      );
      await this.results.uniV3LpVault.connect(this.results.deployer)._pauseDeposits(false);

      await this.results.comptrollerStub.setPauseGuardian(ZERO_ADDRESS);
    });

    it("allows only proper privileges to change periphery function pause state", async function () {
      expect(this.results.uniV3LpVault.connect(this.results.user1)._pausePeripheryFunctions(true)).to.be.revertedWith(
        "only pause guardian and admin can pause",
      );
      await this.results.comptrollerStub.setPauseGuardian(this.results.user1.address);
      await this.results.uniV3LpVault.connect(this.results.user1)._pausePeripheryFunctions(true);
      expect(this.results.uniV3LpVault.connect(this.results.user1)._pausePeripheryFunctions(false)).to.be.revertedWith(
        "only admin can unpause",
      );
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(false);

      await this.results.comptrollerStub.setPauseGuardian(ZERO_ADDRESS);
    });

    it("reverts on deposit when they're paused", async function () {
      // pause it
      await this.results.uniV3LpVault.connect(this.results.deployer)._pauseDeposits(true);
      const amount0Desired = parseUnits("1000", 6).toString();
      const amount1Desired = parseEther("1").toString();
      const blockNumber = await ethers.provider.getBlockNumber();

      await mintFullRangeUsdcWeth(
        this.results.user1,
        this.results.nfpmContract,
        blockNumber,
        amount0Desired,
        amount1Desired,
      );

      const tokenId = await this.results.nfpmContract
        .connect(this.results.user1)
        .tokenOfOwnerByIndex(this.results.user1.address, 0);
      expect(
        this.results.nfpmContract
          .connect(this.results.user1)
          ["safeTransferFrom(address,address,uint256)"](
            this.results.user1.address,
            this.results.uniV3LpVault.address,
            tokenId,
          ),
      ).to.be.revertedWith("deposit is paused");
      await this.results.uniV3LpVault.connect(this.results.deployer)._pauseDeposits(false);
    });

    it("reverts when NFT is not a UniV3 LP NFT", async function () {
      await dummyNftContract.connect(this.results.user1).mintTo(this.results.user1.address);
      expect(
        dummyNftContract
          .connect(this.results.user1)
          ["safeTransferFrom(address,address,uint256)"](
            this.results.user1.address,
            this.results.uniV3LpVault.address,
            this.results.tokenId,
          ),
      ).to.be.revertedWith("IUniV3LpVault::onERC721Received: not a Uni V3 nft");
    });

    it("reverts when user tries to send too many NFTs to vault", async function () {
      const amount0Desired = parseUnits("1000", 6).toString();
      const amount1Desired = parseEther("1").toString();
      const blockNumber = await ethers.provider.getBlockNumber();

      const oldUserTokensMax = await this.results.uniV3LpVault.userTokensMax();
      await this.results.uniV3LpVault.connect(this.results.deployer)._setUserTokensMax(2);
      // already have one deposited, next one should fail

      await mintFullRangeUsdcWeth(
        this.results.user1,
        this.results.nfpmContract,
        blockNumber,
        amount0Desired,
        amount1Desired,
      );

      // get tokenId, assuming there aren't any previous NFTs
      const tokenId = await this.results.nfpmContract
        .connect(this.results.user1)
        .tokenOfOwnerByIndex(this.results.user1.address, 0);
      // have user1 deposit the NFT position
      expect(
        sendNFT(this.results.nfpmContract, this.results.user1, this.results.uniV3LpVault.address, tokenId),
      ).to.be.revertedWith("Cannot process new token: user has too many tokens");

      await this.results.uniV3LpVault.connect(this.results.deployer)._setUserTokensMax(oldUserTokensMax);
    });

    it("reverts when user tries to send an NFT from unsupported pool", async function () {
      const amount0Desired = parseUnits("1000", 6).toString();
      const amount1Desired = parseEther("1").toString();
      const blockNumber = await ethers.provider.getBlockNumber();

      await mintFullRangeUsdcWeth(
        this.results.user1,
        this.results.nfpmContract,
        blockNumber,
        amount0Desired,
        amount1Desired,
        3000,
      );

      // get tokenId, assuming there aren't any previous NFTs
      const tokenId = await this.results.nfpmContract
        .connect(this.results.user1)
        .tokenOfOwnerByIndex(this.results.user1.address, 0);
      // have user1 deposit the NFT position
      expect(
        sendNFT(this.results.nfpmContract, this.results.user1, this.results.uniV3LpVault.address, tokenId),
      ).to.be.revertedWith("comptroller does not support this pool's liquidity as collateral");
    });

    it("withdraws NFT V3 Position while liquid", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await expect(
        this.results.uniV3LpVault
          .connect(this.results.user1)
          .withdrawToken(this.results.tokenId, this.results.user1.address, []),
      )
        .to.emit(this.results.uniV3LpVault, "TokenWithdrawn")
        .withArgs(this.results.user1.address, this.results.user1.address, this.results.tokenId);

      const owner = await this.results.uniV3LpVault.ownerOf(this.results.tokenId);
      expect(owner).to.be.equal(ZERO_ADDRESS);

      const tx = await this.results.nfpmContract
        .connect(this.results.user1)
        ["safeTransferFrom(address,address,uint256)"](
          this.results.user1.address,
          this.results.uniV3LpVault.address,
          this.results.tokenId,
        );
      await tx.wait();
    });

    it("reverts when non-owner attempts to withdraw NFT", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await expect(
        this.results.uniV3LpVault
          .connect(this.results.user2)
          .withdrawToken(this.results.tokenId, this.results.user1.address, []),
      ).to.be.revertedWith("IUniV3LpVault::withdrawToken: only owner can withdraw token");
    });

    it("reverts when attempted to withdraw to the vault contract", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await expect(
        this.results.uniV3LpVault
          .connect(this.results.user1)
          .withdrawToken(this.results.tokenId, this.results.uniV3LpVault.address, []),
      ).to.be.revertedWith("IUniV3LpVault::withdrawToken: cannot withdraw to vault");
    });

    it("does not withdraw NFT V3 Position while in shortfall", async function () {
      await this.results.comptrollerStub.setIsLiquid(false);
      await expect(
        this.results.uniV3LpVault
          .connect(this.results.user1)
          .withdrawToken(this.results.tokenId, this.results.user1.address, []),
      ).to.be.reverted;

      const owner = await this.results.uniV3LpVault.ownerOf(this.results.tokenId);
      expect(owner).to.be.equal(this.results.user1.address);
      await this.results.comptrollerStub.setIsLiquid(true);
    });

    it("sets userTokensMax", async function () {
      const oldUserTokensMax = await this.results.uniV3LpVault.userTokensMax();
      const proposedUserTokensMax = oldUserTokensMax + 2;
      await expect(
        this.results.uniV3LpVault.connect(this.results.deployer)._setUserTokensMax(proposedUserTokensMax),
      ).to.emit(this.results.uniV3LpVault, "NewUserTokensMax");
      const newUserTokensMax = await this.results.uniV3LpVault.userTokensMax();

      expect(proposedUserTokensMax).to.be.equal(newUserTokensMax);
    });

    it("properly sweeps", async function () {
      const amount = parseUnits("1000", 6);
      const user1UsdcBalanceBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      await this.results.ERC20_USDC.connect(this.results.user1).transfer(this.results.uniV3LpVault.address, amount);
      const user1UsdcBalanceAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      expect(user1UsdcBalanceBefore.sub(user1UsdcBalanceAfter)).to.eq(amount);

      const deployerUsdcBalanceBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.deployer.address,
      );
      await this.results.uniV3LpVault
        .connect(this.results.deployer)
        ._sweep(USDC, this.results.deployer.address, amount);
      const deployerUsdcBalanceAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.deployer.address,
      );

      expect(deployerUsdcBalanceAfter.sub(deployerUsdcBalanceBefore)).to.eq(amount);
    });

    it("properly sweeps irrelevant NFT", async function () {
      await dummyNftContract.connect(this.results.user1).mintTo(this.results.user1.address);
      const dummyTokenId = await dummyNftContract.connect(this.results.user1)._currentTokenId();
      await dummyNftContract
        .connect(this.results.user1)
        ["transferFrom(address,address,uint256)"](
          this.results.user1.address,
          this.results.uniV3LpVault.address,
          dummyTokenId,
        );
      expect(await dummyNftContract.ownerOf(dummyTokenId)).to.eq(this.results.uniV3LpVault.address);
      await this.results.uniV3LpVault
        .connect(this.results.deployer)
        ._sweepNFT(dummyNftContract.address, this.results.user1.address, dummyTokenId);
      expect(await dummyNftContract.ownerOf(dummyTokenId)).to.eq(this.results.user1.address);
    });

    it("properly sweeps NFT sent unsafely", async function () {
      const amount0Desired = parseUnits("1000", 6).toString();
      const amount1Desired = parseEther("1").toString();
      const blockNumber = await ethers.provider.getBlockNumber();

      // already have one deposited, next one should fail

      await mintFullRangeUsdcWeth(
        this.results.user1,
        this.results.nfpmContract,
        blockNumber,
        amount0Desired,
        amount1Desired,
      );

      const tokenId = await this.results.nfpmContract
        .connect(this.results.user1)
        .tokenOfOwnerByIndex(this.results.user1.address, 0);
      await this.results.nfpmContract
        .connect(this.results.user1)
        ["transferFrom(address,address,uint256)"](
          this.results.user1.address,
          this.results.uniV3LpVault.address,
          tokenId,
        );

      expect(await this.results.nfpmContract.connect(this.results.user1).ownerOf(tokenId)).to.eq(
        this.results.uniV3LpVault.address,
      );

      await this.results.uniV3LpVault
        .connect(this.results.deployer)
        ._sweepNFT(this.results.nfpmContract.address, this.results.user1.address, tokenId);
      expect(await this.results.nfpmContract.connect(this.results.user1).ownerOf(tokenId)).to.eq(
        this.results.user1.address,
      );
    });

    it("reverts on sweep NFT attempt on real deposit", async function () {
      expect(
        this.results.uniV3LpVault
          .connect(this.results.deployer)
          ._sweepNFT(this.results.nfpmContract.address, this.results.user1.address, this.results.tokenId),
      ).to.be.revertedWith("only NFTs not belonging to depositors can be swept");
    });

    it("reverts on sweep NFT attempt by non-admin", async function () {
      await dummyNftContract.connect(this.results.user1).mintTo(this.results.user1.address);
      const dummyTokenId = await dummyNftContract.connect(this.results.user1)._currentTokenId();
      await dummyNftContract
        .connect(this.results.user1)
        ["transferFrom(address,address,uint256)"](
          this.results.user1.address,
          this.results.uniV3LpVault.address,
          dummyTokenId,
        );
      expect(
        this.results.uniV3LpVault
          .connect(this.results.user1)
          ._sweepNFT(dummyNftContract.address, this.results.user1.address, dummyTokenId),
      ).to.be.revertedWith("only admin can sweep nft assets");
    });

    it("reverts on setUserTokensMax when called from non-admin", async function () {
      expect(this.results.uniV3LpVault.connect(this.results.user2)._setUserTokensMax(10)).to.be.revertedWith(
        "only admin can set new userTokensMax",
      );
    });

    it("reverts on setFlashLoan when called from non-admin", async function () {
      expect(
        this.results.uniV3LpVault.connect(this.results.user2)._setFlashLoan(this.results.comptrollerStub.address),
      ).to.be.revertedWith("only admin can set FlashLoanContract");
    });

    it("reverts on sweep swhen called from non-admin", async function () {
      const amount = parseUnits("1000", 6);
      await this.results.ERC20_USDC.connect(this.results.user1).transfer(this.results.uniV3LpVault.address, amount);
      expect(
        this.results.uniV3LpVault.connect(this.results.deployer)._sweep(USDC, this.results.deployer.address, amount),
      ).to.be.revertedWith("only admin can sweep assets");
    });

    it("reverts on seizeAsset when tokenId is of someone who doesn't own it", async function () {
      const [, , amountToken0FeesCheckpoint1, amountToken1FeesCheckpoint1, , , ,] = await this.results.tickOracle
        .connect(this.results.user2)
        .getTokenBreakdownCurrent(this.results.tokenId);

      // the amount we would like to seize the first time around, of feesToken0, feesToken1, and liquidity
      const seizeFeesToken0Seize1 = Math.round(0.75 * amountToken0FeesCheckpoint1);
      const seizeFeesToken1Seize1 = Math.round(0.75 * amountToken1FeesCheckpoint1);
      const seizeLiquiditySeize1 = 0;

      // in actuality would be called from borrowCToken
      // if this succeeds, should only take 75% of fees and 0 liquidity
      expect(
        this.results.uniV3LpVault
          .connect(this.results.user2)
          .seizeAssets(
            this.results.user2.address,
            this.results.deployer.address,
            this.results.tokenId,
            seizeFeesToken0Seize1,
            seizeFeesToken1Seize1,
            seizeLiquiditySeize1,
          ),
      ).to.be.revertedWith("borrower must own tokenId");
    });

    it("reverts on seize when Comptroller says seize is not allowed", async function () {
      await this.results.comptrollerStub.setSeizeAllowed(false);
      const [, , amountToken0FeesCheckpoint1, amountToken1FeesCheckpoint1, , , ,] = await this.results.tickOracle
        .connect(this.results.user2)
        .getTokenBreakdownCurrent(this.results.tokenId);

      // the amount we would like to seize the first time around, of feesToken0, feesToken1, and liquidity
      const seizeFeesToken0Seize1 = Math.round(0.75 * amountToken0FeesCheckpoint1);
      const seizeFeesToken1Seize1 = Math.round(0.75 * amountToken1FeesCheckpoint1);
      const seizeLiquiditySeize1 = 0;

      // in actuality would be called from borrowCToken
      // if this succeeds, should only take 75% of fees and 0 liquidity
      expect(
        this.results.uniV3LpVault
          .connect(this.results.user2)
          .seizeAssets(
            this.results.user2.address,
            this.results.user1.address,
            this.results.tokenId,
            seizeFeesToken0Seize1,
            seizeFeesToken1Seize1,
            seizeLiquiditySeize1,
          ),
      ).to.be.revertedWith("seize not allowed according to Comptroller");
      await this.results.comptrollerStub.setSeizeAllowed(true);
    });

    // what are the diff conditions we want to test this under?
    it("properly seizes assets", async function () {
      const blockNumber = await ethers.provider.getBlockNumber();

      await this.results.uniRouter.connect(this.results.deployer).exactInputSingle({
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 500,
        recipient: this.results.deployer.address,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        amountIn: parseUnits("1000000", 6).toString(),
        amountOutMinimum: parseEther("0.01").toString(),
        sqrtPriceLimitX96: 0,
      });

      await this.results.uniRouter.connect(this.results.deployer).exactInputSingle({
        tokenIn: WETH,
        tokenOut: USDC,
        fee: 500,
        recipient: this.results.deployer.address,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        amountIn: parseEther("2000").toString(),
        amountOutMinimum: parseUnits("1", 6).toString(),
        sqrtPriceLimitX96: 0,
      });

      const [
        ,
        ,
        amountToken0FeesCheckpoint1,
        amountToken1FeesCheckpoint1,
        amountToken0LiquidityCheckpoint1,
        amountToken1LiquidityCheckpoint1,
        liquidityCheckpoint1,
      ] = await this.results.tickOracle.connect(this.results.user2).getTokenBreakdownCurrent(this.results.tokenId);

      // the amount we would like to seize the first time around, of feesToken0, feesToken1, and liquidity
      const seizeFeesToken0Seize1 = Math.round(0.75 * amountToken0FeesCheckpoint1);
      const seizeFeesToken1Seize1 = Math.round(0.75 * amountToken1FeesCheckpoint1);
      const seizeLiquiditySeize1 = 0;

      // checkpoint initial balances
      const amount0Checkpoint1 = await this.results.ERC20_USDC.connect(this.results.user2).balanceOf(
        this.results.user2.address,
      );
      const amount1Checkpoint1 = await this.results.ERC20_WETH.connect(this.results.user2).balanceOf(
        this.results.user2.address,
      );

      // in actuality would be called from borrowCToken
      // if this succeeds, should only take 75% of fees and 0 liquidity
      await this.results.uniV3LpVault
        .connect(this.results.user2)
        .seizeAssets(
          this.results.user2.address,
          this.results.user1.address,
          this.results.tokenId,
          seizeFeesToken0Seize1,
          seizeFeesToken1Seize1,
          seizeLiquiditySeize1,
        );

      // checkpoint our balances
      const amount0Checkpoint2 = await this.results.ERC20_USDC.connect(this.results.user2).balanceOf(
        this.results.user2.address,
      );
      const amount1Checkpoint2 = await this.results.ERC20_WETH.connect(this.results.user2).balanceOf(
        this.results.user2.address,
      );

      // how much have our balances changed?
      const amount0Diff1 = amount0Checkpoint2 - amount0Checkpoint1;
      const amount1Diff1 = amount1Checkpoint2 - amount1Checkpoint1;

      // expect our change to be equiv to how much we seized
      expect(isSimilar(amount0Diff1.toString(), seizeFeesToken0Seize1.toString())).to.be.true;
      expect(isSimilar(amount1Diff1.toString(), seizeFeesToken1Seize1.toString())).to.be.true;

      // the seizeFees values don't matter since liquidity is populated, but will be useful for checks later
      const seizeFeesToken0Seize2 = Math.round(0.25 * amountToken0FeesCheckpoint1);
      const seizeFeesToken1Seize2 = Math.round(0.25 * amountToken1FeesCheckpoint1);
      const seizeLiquiditySeize2 = Math.round(0.75 * liquidityCheckpoint1);

      // in actuality would be called from borrowCToken
      // if this succeeds, fees should be emptied and liquidity decreased by the seize amount
      await this.results.uniV3LpVault.connect(this.results.user2).seizeAssets(
        this.results.user2.address,
        this.results.user1.address,
        this.results.tokenId,
        0, // doesn't matter if liquidity is populated
        0, // doesn't matter if liquidity is populated
        seizeLiquiditySeize2,
      );

      // again checkpoint our balances
      const amount0Checkpoint3 = await this.results.ERC20_USDC.connect(this.results.user2).balanceOf(
        this.results.user2.address,
      );
      const amount1Checkpoint3 = await this.results.ERC20_WETH.connect(this.results.user2).balanceOf(
        this.results.user2.address,
      );

      // how have our balances changed this time?
      const amount0Diff2 = amount0Checkpoint3 - amount0Checkpoint2;
      const amount1Diff2 = amount1Checkpoint3 - amount1Checkpoint2;

      const [
        ,
        ,
        amountToken0FeesCheckpoint3,
        amountToken1FeesCheckpoint3,
        amountToken0LiquidityCheckpoint3,
        amountToken1LiquidityCheckpoint3,
        liquidityCheckpoint3,
      ] = await this.results.tickOracle.connect(this.results.user2).getTokenBreakdownCurrent(this.results.tokenId);

      // how much we expected to have seized
      const expectedToken0SeizedTotal = Math.round(seizeFeesToken0Seize2 + 0.75 * amountToken0LiquidityCheckpoint1);
      const expectedToken1SeizedTotal = Math.round(seizeFeesToken1Seize2 + 0.75 * amountToken1LiquidityCheckpoint1);

      // how much of liquidity tokens we expect to remain
      const expectedToken0LiquidityRemaining = Math.round(0.25 * amountToken0LiquidityCheckpoint1);
      const expectedToken1LiquidityRemaining = Math.round(0.25 * amountToken1LiquidityCheckpoint1);

      // how much of fees we expect to remain (should've seized everything since liquidity value was non-zero)
      const expectedToken0FeesRemaining = 0;
      const expectedToken1FeesRemaining = 0;

      // we seized 75% of liquidity, so expect 25% to remain
      const expectedLiquidityRemaining = Math.round(0.25 * liquidityCheckpoint1);

      expect(isSimilar(amount0Diff2.toString(), expectedToken0SeizedTotal.toString())).to.be.true;
      expect(isSimilar(amount1Diff2.toString(), expectedToken1SeizedTotal.toString())).to.be.true;
      expect(isSimilar(amountToken0FeesCheckpoint3.toString(), expectedToken0FeesRemaining.toString())).to.be.true;
      expect(isSimilar(amountToken1FeesCheckpoint3.toString(), expectedToken1FeesRemaining.toString())).to.be.true;
      expect(isSimilar(amountToken0LiquidityCheckpoint3.toString(), expectedToken0LiquidityRemaining.toString())).to.be
        .true;
      expect(isSimilar(amountToken1LiquidityCheckpoint3.toString(), expectedToken1LiquidityRemaining.toString())).to.be
        .true;
      expect(isSimilar(liquidityCheckpoint3.toString(), expectedLiquidityRemaining.toString())).to.be.true;
    });
  });

  describe("accuracy of calculations", function () {
    before("setup Lp Vault", async function () {
      //@ts-ignore
      this.results = await testSetup();
    });
    it("accurately calculates token balance from liquidity", async function () {
      // ensure that amountToken#Liquidity matches what we originally put into the position
      //@ts-ignore
      const [, , , , amountToken0Liquidity, amountToken1Liquidity] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      expect(isSimilar(amountToken0Liquidity.toString(), this.results.amount0.toString())).to.be.true;
      expect(isSimilar(amountToken1Liquidity.toString(), this.results.amount1.toString())).to.be.true;
    });

    // calculate fee growth before update, ensure it exists (make trades and see if amountToken#Fees increases w/o poke)
    it("accurately calculates fee growth", async function () {
      // want to use exactInputSingle from uniswap V3 swap router (maybe create helper for this)
      const blockNumber = await ethers.provider.getBlockNumber();

      await this.results.uniRouter.connect(this.results.deployer).exactInputSingle({
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 500,
        recipient: this.results.deployer.address,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        amountIn: parseUnits("1000000", 6).toString(),
        amountOutMinimum: parseEther("0.01").toString(),
        sqrtPriceLimitX96: 0,
      });

      await this.results.uniRouter.connect(this.results.deployer).exactInputSingle({
        tokenIn: WETH,
        tokenOut: USDC,
        fee: 500,
        recipient: this.results.deployer.address,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        amountIn: parseEther("2000").toString(),
        amountOutMinimum: parseUnits("1", 6).toString(),
        sqrtPriceLimitX96: 0,
      });

      const [, , amountToken0Fees, amountToken1Fees, , ,] = await this.results.tickOracle.getTokenBreakdownCurrent(
        this.results.tokenId,
      );

      // pull position back to wallet to be able to poke (can remove once we have pass through functionality)
      await this.results.uniV3LpVault
        .connect(this.results.user1)
        .withdrawToken(this.results.tokenId, this.results.user1.address, []);

      const amount0Before = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const amount1Before = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      // collect all fees
      await this.results.nfpmContract.connect(this.results.user1).collect({
        tokenId: this.results.tokenId,
        recipient: this.results.user1.address,
        amount0Max: BigNumber.from("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
        amount1Max: BigNumber.from("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
      });

      const amount0After = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const amount1After = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      const collected0 = amount0After - amount0Before;
      const collected1 = amount1After - amount1Before;

      expect(isSimilar(amountToken0Fees.toString(), collected0.toString())).to.be.true;
      expect(isSimilar(amountToken1Fees.toString(), collected1.toString())).to.be.true;
    });

    xit("has TWAP calculations unaffected by price manipulation", async function () {});
  });

  describe("periphery functionality", function () {
    before("setup Lp Vault", async function () {
      //@ts-ignore
      this.results = await testSetup();
    });
    xit("allows admin to deposits LP on behalf of someone else", async function () {
      // withdraw token to deployer
      // transfer to deployer
      // have deployer do a SFT with data for user1 ownership
      // verify that user1 owns

      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.uniV3LpVault
        .connect(this.results.user1)
        .withdrawToken(this.results.tokenId, this.results.deployer.address, []);

      const intermediateOwner = await this.results.nfpmContract
        .connect(this.results.user1)
        .ownerOf(this.results.tokenId);
      expect(this.results.deployer.address).to.be.eq(intermediateOwner);

      const bytesData = this.results.user1.address;
      const tx2 = await this.results.nfpmContract
        .connect(this.results.deployer)
        ["safeTransferFrom(address,address,uint256,bytes)"](
          this.results.deployer.address,
          this.results.uniV3LpVault.address,
          this.results.tokenId,
          bytesData,
        );
      await tx2.wait();

      const owner = await this.results.uniV3LpVault.ownerOf(this.results.tokenId);
      expect(owner).to.be.eq(this.results.user1.address);
    });

    it("doesn't allow non-admin to deposits LP on behalf of someone else", async function () {
      // withdraw token
      // transfer to deployer
      // have deployer do a SFT with data for user1 ownership
      // verify that user1 does not own (non-admin does)
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.uniV3LpVault
        .connect(this.results.user1)
        .withdrawToken(this.results.tokenId, this.results.user2.address, []);

      const bytesData = this.results.user1.address;
      const tx = await this.results.nfpmContract
        .connect(this.results.user2)
        ["safeTransferFrom(address,address,uint256,bytes)"](
          this.results.user2.address,
          this.results.uniV3LpVault.address,
          this.results.tokenId,
          bytesData,
        );
      await tx.wait();

      const owner = await this.results.uniV3LpVault.ownerOf(this.results.tokenId);
      expect(owner).to.be.eq(this.results.user2.address);

      await this.results.uniV3LpVault
        .connect(this.results.user2)
        .withdrawToken(this.results.tokenId, this.results.user1.address, []);

      const tx2 = await this.results.nfpmContract
        .connect(this.results.user1)
        ["safeTransferFrom(address,address,uint256)"](
          this.results.user1.address,
          this.results.uniV3LpVault.address,
          this.results.tokenId,
        );
      await tx2.wait();
    });

    it("properly increases liquidity using nonfungiblePositionManager", async function () {
      // increase liquidity, check that liquidity of position increased appropriately
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.nfpmContract.connect(this.results.user1).increaseLiquidity({
        tokenId: this.results.tokenId,
        amount0Desired: parseUnits("1", getERC20Decimals(Token.USDC)),
        amount1Desired: parseUnits("1", getERC20Decimals(Token.WETH)),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , , , , , , newLiquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      expect(newLiquidity).to.be.gt(liquidity);
    });

    it("properly decreases liquidity", async function () {
      // check that decrease liquidity properly works
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , , , , , , newLiquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      expect(newLiquidity).to.be.lt(liquidity);
    });

    it("reverts on decrease liquidity when paused", async function () {
      // check same as above but from diff account
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
          tokenId: this.results.tokenId,
          liquidity: liquidity.div(10),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        }),
      ).to.be.revertedWith("periphery functionality is paused");
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(false);
    });

    it("reverts on decrease liquidity when not owner", async function () {
      // check same as above but from diff account
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.deployer).decreaseLiquidity({
          tokenId: this.results.tokenId,
          liquidity: liquidity.div(10),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        }),
      ).to.be.revertedWith("sender must be owner of deposited tokenId");
    });

    it("reverts on too large of decreased liquidity", async function () {
      // try to decrease when in shortfall
      await this.results.comptrollerStub.setIsLiquid(false);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
          tokenId: this.results.tokenId,
          liquidity: liquidity.div(10),
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
        }),
      ).to.be.revertedWith("insufficient liquidity");

      await this.results.comptrollerStub.setIsLiquid(true);
    });

    it("properly collects fees", async function () {
      // decrease liquidity, check that fees are in position. Then check that we can collect them
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: liquidity.div(10),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , , , , , , , , , firstFees0, firstFees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).collectFees({
          tokenId: this.results.tokenId,
          recipient: this.results.user1.address,
          amount0Max: firstFees0,
          amount1Max: 0,
        }),
      ).to.emit(this.results.uniV3LpVault, "FeesCollected");

      const [, , , , , , , , , , secondFees0, secondFees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      expect(secondFees0).to.be.eq(0);
      expect(secondFees1).to.be.eq(firstFees1);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).collectFees({
          tokenId: this.results.tokenId,
          recipient: this.results.user1.address,
          amount0Max: 0,
          amount1Max: Math.round(0.5 * firstFees1).toString(),
        }),
      ).to.emit(this.results.uniV3LpVault, "FeesCollected");

      const [, , , , , , , , , , thirdFees0, thirdFees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      expect(thirdFees0).to.be.eq(0);
      expect(isSimilar(thirdFees1.toString(), (0.5 * firstFees1).toString())).to.be.true;
    });

    it("reverts on collect fees when paused", async function () {
      // try same as above except from another account
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(true);

      const [, , , , , , , , , , fees0, fees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).collectFees({
          tokenId: this.results.tokenId,
          recipient: this.results.user2.address,
          amount0Max: fees0,
          amount1Max: fees1,
        }),
      ).to.be.revertedWith("periphery functionality is paused");
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(false);
    });

    it("reverts on collect fees when not owner", async function () {
      // try same as above except from another account
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , , , , , , , , , fees0, fees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user2).collectFees({
          tokenId: this.results.tokenId,
          recipient: this.results.user2.address,
          amount0Max: fees0,
          amount1Max: fees1,
        }),
      ).to.be.revertedWith("sender must be owner of deposited tokenId");
    });

    it("reverts on too large of collect fees", async function () {
      // try to collect fees when in shortfall
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      await this.results.comptrollerStub.setIsLiquid(false);

      const [, , , , , , , , , , fees0, fees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).collectFees({
          tokenId: this.results.tokenId,
          recipient: this.results.user1.address,
          amount0Max: fees0,
          amount1Max: fees1,
        }),
      ).to.be.revertedWith("insufficient liquidity");

      await this.results.comptrollerStub.setIsLiquid(true);
    });

    it("properly compounds fees", async function () {
      // increase liquidity, decrease it (to put funds into fees), then remove almost all of one side
      // do calculations for how much of each token it should deposit
      // verify that very small amount is returned

      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      // collect some fees to alter the balance
      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).collectFees({
          tokenId: this.results.tokenId,
          recipient: this.results.user1.address,
          amount0Max: amountToken0Fees,
          amount1Max: 0,
        }),
      ).to.emit(this.results.uniV3LpVault, "FeesCollected");

      // need to calculate expected deposits :/ could do staticCall of swap to get price
      // can look at token0Liquidity and token1Liquidity for expected balance
      // static call on swap for current price
      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          recipient: this.results.deployer.address,
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

      const balanceToken0Before = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const balanceToken1Before = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).compoundFees({
          tokenId: this.results.tokenId,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
        }),
      ).to.emit(this.results.uniV3LpVault, "FeesCompounded");

      const balanceToken0After = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const balanceToken1After = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      const amountTaken0 = expectedAmount0 - (balanceToken0After - balanceToken0Before);
      const amountTaken1 = expectedAmount1 - (balanceToken1After - balanceToken1Before);

      expect(isSimilar(amountTaken0.toString(), expectedAmount0.toString())).to.be.true;
      expect(isSimilar(amountTaken1.toString(), expectedAmount1.toString())).to.be.true;
    });

    it("reverts on compound fees when paused", async function () {
      // call compound fees function from another account
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(true);
      const [, , , , , , , , , , fees0, fees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).compoundFees({
          tokenId: this.results.tokenId,
          expectedAmount0: fees0,
          expectedAmount1: fees1,
          amount0Min: 0,
          amount1Min: 0,
        }),
      ).to.be.revertedWith("periphery functionality is paused");
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(false);
    });

    it("reverts on compound fees when not owner", async function () {
      // call compound fees function from another account
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , , , , , , , , , fees0, fees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user2).compoundFees({
          tokenId: this.results.tokenId,
          expectedAmount0: fees0,
          expectedAmount1: fees1,
          amount0Min: 0,
          amount1Min: 0,
        }),
      ).to.be.revertedWith("sender must be owner of deposited tokenId");
    });

    it("reverts on compound fees when not enough tokens are utilized", async function () {
      // set min too high on one of the tokens
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , , , liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , , , , , , , , , fees0, fees1] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).compoundFees({
          tokenId: this.results.tokenId,
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
      await this.results.comptrollerStub.setIsLiquid(true);
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
        recipient: this.results.user1.address,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      };
      const tx = await this.results.nfpmContract.connect(this.results.user1).mint(mintParams);
      await tx.wait();

      // get tokenId, assuming 1 old tokenId
      const newTokenId = await this.results.nfpmContract
        .connect(this.results.user1)
        .tokenOfOwnerByIndex(this.results.user1.address, 0);

      const tx2 = await this.results.nfpmContract
        .connect(this.results.user1)
        ["safeTransferFrom(address,address,uint256)"](
          this.results.user1.address,
          this.results.uniV3LpVault.address,
          newTokenId,
        );
      await tx2.wait();

      const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(newTokenId);

      const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      // attempt to deposit all of current amounts as is
      const expectedAmount0 = amountToken0Fees + amountToken0Liquidity;
      const expectedAmount1 = amountToken1Fees + amountToken1Liquidity;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).moveRange({
          tokenId: newTokenId,
          liquidity: liquidity,
          newTickLower: Math.round(tickLower / 2).toString(),
          newTickUpper: Math.round(tickUpper / 2).toString(),
          expectedAmount0: expectedAmount0,
          expectedAmount1: expectedAmount1,
          amount0Min: 0,
          amount1Min: 0,
        }),
      ).to.emit(this.results.uniV3LpVault, "RangeMoved");
      // since we moved full liquidity, expect this.results.tokenId to be burnt
      await expect(this.results.tickOracle.getTokenBreakdownCurrent(newTokenId)).to.be.reverted;

      const newNewTokenId = await this.results.uniV3LpVault
        .connect(this.results.user1)
        .userTokens(this.results.user1.address, 1);
      await this.results.uniV3LpVault
        .connect(this.results.user1)
        .withdrawToken(newNewTokenId, this.results.user1.address, []);
    });

    it("properly moves partial range", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);

      const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const expectedAmount0 = amountToken0Fees + amountToken0Liquidity;
      const expectedAmount1 = amountToken1Fees + amountToken1Liquidity;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).moveRange({
          tokenId: this.results.tokenId,
          liquidity: Math.round(liquidity / 2).toString(),
          newTickLower: Math.round(tickLower / 2).toString(),
          newTickUpper: Math.round(tickUpper / 2).toString(),
          expectedAmount0: expectedAmount0,
          expectedAmount1: expectedAmount1,
          amount0Min: 0,
          amount1Min: 0,
        }),
      ).to.emit(this.results.uniV3LpVault, "RangeMoved");

      const newTokenId = await this.results.uniV3LpVault
        .connect(this.results.user1)
        .userTokens(this.results.user1.address, 0);

      await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);
      await this.results.tickOracle.getTokenBreakdownCurrent(newTokenId);
    });

    it("properly moves partial range, only fees", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      // move some funds into fees of the tokenId (from liquidity)
      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: Math.round(0.1 * liquidity),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const expectedAmount0 = amountToken0Fees;
      const expectedAmount1 = amountToken1Fees;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).moveRange({
          tokenId: this.results.tokenId,
          liquidity: 0,
          newTickLower: Math.round(tickLower / 2).toString(),
          newTickUpper: Math.round(tickUpper / 2).toString(),
          expectedAmount0: expectedAmount0,
          expectedAmount1: expectedAmount1,
          amount0Min: 0,
          amount1Min: 0,
        }),
      ).to.emit(this.results.uniV3LpVault, "RangeMoved");

      const newTokenId = await this.results.uniV3LpVault
        .connect(this.results.user1)
        .userTokens(this.results.user1.address, 0);

      await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);
      await this.results.tickOracle.getTokenBreakdownCurrent(newTokenId);
    });

    it("reverts on move range when paused", async function () {
      // call move range when not owner
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(true);

      const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).moveRange({
          tokenId: this.results.tokenId,
          liquidity: liquidity,
          newTickLower: Math.round(tickLower / 2).toString(),
          newTickUpper: Math.round(tickUpper / 2).toString(),
          expectedAmount0: amountToken0Fees + amountToken0Liquidity,
          expectedAmount1: amountToken1Fees + amountToken1Liquidity,
          amount0Min: 0,
          amount1Min: 0,
        }),
      ).to.be.revertedWith("periphery functionality is paused");
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(false);
    });

    it("reverts on move range when not owner", async function () {
      // call move range when not owner
      await this.results.comptrollerStub.setIsLiquid(true);

      const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user2).moveRange({
          tokenId: this.results.tokenId,
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
      await this.results.comptrollerStub.setIsLiquid(true);

      const [, , , , , tickLower, tickUpper, liquidity, , , ,] = await this.results.nfpmContract
        .connect(this.results.user1)
        .positions(this.results.tokenId);

      const [, , amountToken0Fees, amountToken1Fees, amountToken0Liquidity, amountToken1Liquidity, ,] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const amount0 = amountToken0Fees + amountToken0Liquidity;
      const amount1 = amountToken1Fees + amountToken1Liquidity;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).moveRange({
          tokenId: this.results.tokenId,
          liquidity: liquidity,
          newTickLower: Math.round(tickLower / 2).toString(),
          newTickUpper: Math.round(tickUpper / 2).toString(),
          expectedAmount0: amount0,
          expectedAmount1: amount1,
          amount0Min: Math.round(amount0 * 1.01).toString(),
          amount1Min: Math.round(amount0 * 1.01).toString(),
        }),
      ).to.be.reverted;
    });

    it("properly repays debt", async function () {
      // this is a stub test, so there is no real "debt" to repay
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const swapPath1 = encodePath([WETH, USDC], [500]);

      const liquidityBurnFactor = 0.15;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.1 * amountToken0Liquidity);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseEther("1").toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

      const amount0UserBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const amount0CTokenBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.cUSDCStub.address,
      );
      const amount0VaultBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.uniV3LpVault.address,
      );

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(),
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: swapPath1, // swapPath can just be through this current pool
        }),
      ).to.emit(this.results.uniV3LpVault, "RepayDebt");

      const [, , , , , , amountLiquidityAfter] = await this.results.tickOracle.getTokenBreakdownCurrent(
        this.results.tokenId,
      );

      const amount0UserAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const amount0CTokenAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.cUSDCStub.address,
      );
      const amount0VaultAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.uniV3LpVault.address,
      );

      const amount0UserGained = amount0UserAfter - amount0UserBefore;
      const amount0CTokenGained = amount0CTokenAfter - amount0CTokenBefore;
      const amountLiquidityReduced = amountLiquidityBefore - amountLiquidityAfter;
      const amountVaultGained = amount0VaultAfter - amount0VaultBefore;

      const expectedAmount0UserGained =
        (hypotheticalAmountOut * (liquidityBurnFactor * amountToken1Liquidity)) / 1e18 +
        liquidityBurnFactor * amountToken0Liquidity -
        repayAmount;

      expect(isSimilar(amountLiquidityReduced.toString(), liquidityBurnAmount.toString())).to.be.true;
      expect(isSimilar(amount0CTokenGained.toString(), repayAmount.toString())).to.be.true;
      expect(isSimilar(amount0UserGained.toString(), expectedAmount0UserGained.toString())).to.be.true;
      expect(amountVaultGained).to.eq(0);
    });

    it("properly repays debt, with only fees", async function () {
      // this is a stub test, so there is no real "debt" to repay
      await this.results.comptrollerStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const swapPath1 = encodePath([WETH, USDC], [500]);

      const liquidityBurnFactor = 0.15;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);

      // move funds into fees (from liquidity). No difference for rest of test how the fees got there
      await this.results.uniV3LpVault.connect(this.results.user1).decreaseLiquidity({
        tokenId: this.results.tokenId,
        liquidity: liquidityBurnAmount,
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
      });

      const repayAmount = Math.round(0.1 * amountToken0Liquidity);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseEther("1").toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

      const amount0UserBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const amount0CTokenBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.cUSDCStub.address,
      );
      const amount0VaultBefore = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.uniV3LpVault.address,
      );

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: 0,
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: swapPath1, // swapPath can just be through this current pool
        }),
      ).to.emit(this.results.uniV3LpVault, "RepayDebt");

      const [, , , , , , amountLiquidityAfter] = await this.results.tickOracle.getTokenBreakdownCurrent(
        this.results.tokenId,
      );

      const amount0UserAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const amount0CTokenAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.cUSDCStub.address,
      );
      const amount0VaultAfter = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.uniV3LpVault.address,
      );

      const amount0UserGained = amount0UserAfter - amount0UserBefore;
      const amount0CTokenGained = amount0CTokenAfter - amount0CTokenBefore;
      const amountLiquidityReduced = amountLiquidityBefore - amountLiquidityAfter;
      const amountVaultGained = amount0VaultAfter - amount0VaultBefore;

      const expectedAmount0UserGained =
        (hypotheticalAmountOut * (liquidityBurnFactor * amountToken1Liquidity)) / 1e18 +
        liquidityBurnFactor * amountToken0Liquidity -
        repayAmount;

      expect(isSimilar(amountLiquidityReduced.toString(), liquidityBurnAmount.toString())).to.be.true;
      expect(isSimilar(amount0CTokenGained.toString(), repayAmount.toString())).to.be.true;
      expect(isSimilar(amount0UserGained.toString(), expectedAmount0UserGained.toString())).to.be.true;
      expect(amountVaultGained).to.eq(0);
    });

    it("reverts on repay when paused", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(true);

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const swapPath1 = encodePath([WETH, USDC], [500]);

      const liquidityBurnFactor = 0.15;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.1 * amountToken0Liquidity);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: swapPath1, // swapPath can just be through this current pool
        }),
      ).to.be.revertedWith("periphery functionality is paused");
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(false);
    });

    it("reverts when other user tries to repay debt", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const swapPath1 = encodePath([WETH, USDC], [500]);

      const liquidityBurnFactor = 0.15;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.1 * amountToken0Liquidity);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user2).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: swapPath1, // swapPath can just be through this current pool
        }),
      ).to.be.revertedWith("sender must be owner of deposited tokenId");
    });

    // will have to test this on actual compound
    it("reverts when not enough debt was repayed", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const liquidityBurnFactor = 0.1;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.5 * amountToken0Liquidity);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: [], // swapPath can just be through this current pool
        }),
      ).to.be.revertedWith("not enough liquidity burned: Repay debt must repay repayAmount of debt");
    });

    it("reverts when debt repayment fails", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setRepaySuccess(false);

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const liquidityBurnFactor = 0.4;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.2 * amountToken0Liquidity);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: [], // swapPath can just be through this current pool
        }),
      ).to.be.revertedWith("repay debt did not succeed");
      await this.results.cUSDCStub.setRepaySuccess(true);
    });

    it("reverts when debtCToken is not listed", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setRepaySuccess(true);

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const liquidityBurnFactor = 0.4;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.2 * amountToken0Liquidity);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cDAIStub.address,
          underlying: DAI,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: [], // swapPath can just be through this current pool
        }),
      ).to.be.revertedWith("Debt CToken must be listed by comptroller");
    });

    it("reverts when underlying does not match that of debtCToken", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setRepaySuccess(true);

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const liquidityBurnFactor = 0.4;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.2 * amountToken0Liquidity);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: WBTC,
          swapPath0: [], // don't need swapPath for USDC
          swapPath1: [], // swapPath can just be through this current pool
        }),
      ).to.be.revertedWith("Underlying must match CToken underlying");
    });

    it("reverts when provided swap paths are bad", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const liquidityBurnFactor = 0.1;

      const liquidityBurnAmount = Math.round(liquidityBurnFactor * amountLiquidityBefore);
      const repayAmount = Math.round(0.5 * amountToken0Liquidity);
      const bunkPath = encodePath([this.results.uniV3LpVault.address, this.results.comptrollerStub.address], [500]);

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: bunkPath, // bunkPath
          swapPath1: [], // emptyPath
        }),
      ).to.be.revertedWith("swapPath0 did not pass integrity check");

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).repayDebt({
          tokenId: this.results.tokenId,
          liquidity: liquidityBurnAmount.toString(), // can move partial liquidity
          repayAmount: repayAmount.toString(),
          debtCToken: this.results.cUSDCStub.address,
          underlying: USDC,
          swapPath0: [], // emptyPath
          swapPath1: bunkPath, // bunkPath
        }),
      ).to.be.revertedWith("swapPath1 did not pass integrity check");
    });

    it("properly executes flashFocus", async function () {
      // need stubErc20 to have sufficient funds
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity;

      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      const balanceToken0Before = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const balanceToken1Before = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).flashFocus({
          tokenId: this.results.tokenId,
          asset: USDC,
          amount: amount,
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: [],
        }),
      ).to.emit(this.results.uniV3LpVault, "FlashFocus");

      const balanceToken0After = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const balanceToken1After = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      const amountTaken0 = expectedAmount0 - (balanceToken0After - balanceToken0Before);
      const amountTaken1 = expectedAmount1 - (balanceToken1After - balanceToken1Before);

      expect(isSimilar(amountTaken0.toString(), expectedAmount0.toString())).to.be.true;
      expect(isSimilar(amountTaken1.toString(), expectedAmount1.toString())).to.be.true;
    });

    it("properly executes flashFocus with swap path", async function () {
      // need stubErc20 to have sufficient funds
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cWBTCStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

      const hypotheticalAmountOut2 = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: WBTC,
          tokenOut: USDC,
          fee: 3000,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 8).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

      // need to convert amount usdc to amount wbtc
      const amount = ((2 * amountToken0Liquidity) / hypotheticalAmountOut2) * parseUnits("1", 8).toNumber();

      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      const balanceToken0Before = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const balanceToken1Before = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).flashFocus({
          tokenId: this.results.tokenId,
          asset: WBTC,
          amount: Math.round(amount),
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: encodePath([WBTC, USDC], [3000]),
        }),
      ).to.emit(this.results.uniV3LpVault, "FlashFocus");

      const balanceToken0After = await this.results.ERC20_USDC.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );
      const balanceToken1After = await this.results.ERC20_WETH.connect(this.results.user1).balanceOf(
        this.results.user1.address,
      );

      const amountTaken0 = expectedAmount0 - (balanceToken0After - balanceToken0Before);
      const amountTaken1 = expectedAmount1 - (balanceToken1After - balanceToken1Before);

      expect(isSimilar(amountTaken0.toString(), expectedAmount0.toString())).to.be.true;
      expect(isSimilar(amountTaken1.toString(), expectedAmount1.toString())).to.be.true;
    });

    it("reverts when bunk swapPath", async function () {
      // need stubErc20 to have sufficient funds
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity;

      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).flashFocus({
          tokenId: this.results.tokenId,
          asset: WBTC,
          amount: amount,
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: encodePath([this.results.uniV3LpVault.address, this.results.comptrollerStub.address], [500]),
        }),
      ).to.be.revertedWith("swapPath did not pass integrity check");
    });

    it("reverts on flashFocus when paused", async function () {
      // need stubErc20 to have sufficient funds
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(true);
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity;

      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).flashFocus({
          tokenId: this.results.tokenId,
          asset: USDC,
          amount: amount,
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: [],
        }),
      ).to.be.revertedWith("periphery functionality is paused");
      await this.results.uniV3LpVault.connect(this.results.deployer)._pausePeripheryFunctions(false);
    });

    it("reverts when other user tries to flashFocus", async function () {
      // need stubErc20 to have sufficient funds
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity;

      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user2).flashFocus({
          tokenId: this.results.tokenId,
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
      // need stubErc20 to have sufficient funds
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(false);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity; // amount doesn't matter here

      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      // try to flashFocus when we can't borrow anything
      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).flashFocus({
          tokenId: this.results.tokenId,
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

      await this.results.cUSDCStub.setIsLiquid(true);
    });

    it("reverts on faulty user input configuration", async function () {
      // call with debt asset that is not a pool asset and without a swappath
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity; // amount doesn't actually matter here

      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user1).flashFocus({
          tokenId: this.results.tokenId,
          asset: WBTC,
          amount: amount,
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: [],
        }),
      ).to.be.revertedWith("flashLoaned asset must be a pool asset or swapping to token0");
    });

    it("reverts when user tries to flashFocusCall", async function () {
      // need stubErc20 to have sufficient funds
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(true);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity;

      // TODO: put below into a helper
      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user2).flashFocusCall({
          tokenId: this.results.tokenId,
          asset: USDC,
          amount: amount,
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: [],
        }),
      ).to.be.revertedWith("Can only be called from our flashLoan contract");
    });

    it("reverts when flashFocus was unauthorized", async function () {
      await this.results.comptrollerStub.setIsLiquid(true);
      await this.results.cUSDCStub.setIsLiquid(true);

      // will set user to flashFocus contract address to bypass first check and authorization flow
      await this.results.uniV3LpVault.connect(this.results.deployer)._setFlashLoan(this.results.user2.address);
      const blockNumber = await ethers.provider.getBlockNumber();

      const [, , , , amountToken0Liquidity, amountToken1Liquidity, amountLiquidityBefore] =
        await this.results.tickOracle.getTokenBreakdownCurrent(this.results.tokenId);

      const hypotheticalAmountOut = await this.results.uniRouter
        .connect(this.results.deployer)
        .callStatic.exactInputSingle({
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 500,
          recipient: this.results.deployer.address,
          deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
          amountIn: parseUnits("1", 6).toString(),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });
      const amount = 3 * amountToken0Liquidity;

      // TODO: put below into a helper
      const zValue = (amountToken0Liquidity * 1e30) / amountToken1Liquidity;
      const denom = 1e18 + (zValue * hypotheticalAmountOut) / 1e18;
      const expectedAmountLess0 = (amount * 1e18) / denom;
      const expectedAmount0 = amount - expectedAmountLess0;
      const expectedAmount1 = (expectedAmountLess0 * hypotheticalAmountOut) / 1e18;

      await expect(
        this.results.uniV3LpVault.connect(this.results.user2).flashFocusCall({
          tokenId: this.results.tokenId,
          asset: USDC,
          amount: amount,
          premium: 0,
          expectedAmount0: Math.round(expectedAmount0).toString(),
          expectedAmount1: Math.round(expectedAmount1).toString(),
          amount0Min: 0,
          amount1Min: 0,
          swapPath: [],
        }),
      ).to.be.revertedWith("flashLoan action must have been authorized by tokenId owner");

      // set flashLoan back to normal
      await this.results.uniV3LpVault
        .connect(this.results.deployer)
        ._setFlashLoan(this.results.flashLoanReceiver.address);
    });
  });
});
