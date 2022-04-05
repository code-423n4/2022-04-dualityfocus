import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Overrides } from "ethers";

import {
  BaseJumpRateModelV2,
  CErc20Immutable,
  CErc20Immutable__factory,
  Comptroller,
  Comptroller__factory,
  JumpRateModelV2__factory,
  SimplePriceOracle,
  SimplePriceOracle__factory,
  SimpleTickOracle,
  SimpleTickOracle__factory,
  Unitroller,
  Unitroller__factory,
  WhitePaperInterestRateModel,
  WhitePaperInterestRateModel__factory,
} from "../typechain";

import { CTOKEN, INTEREST_RATE_MODEL } from "./configs";
import { CTokenType, InterestRateModelType } from "./enums";
import {
  CErc20Args,
  CompoundV2,
  CTokenArgs,
  CTokenDeployArg,
  CTokenLike,
  CTokens,
  InterestRateModelConfig,
  InterestRateModels,
  JumpRateModelV2Args,
  WhitePaperInterestRateModelArgs,
} from "./interfaces";

export async function deployCompoundV2(
  underlying: CTokenDeployArg[],
  deployer: SignerWithAddress,
  overrides?: Overrides,
): Promise<CompoundV2> {
  const comptroller = await deployComptroller(deployer, deployer.address, overrides);
  console.log("#1 Comptroller Deployed at: ", comptroller.address);

  const priceOracle = await deployPriceOracle(deployer, overrides);
  console.log("#2 PriceOracle Deployed at: ", comptroller.address);

  await comptroller._setPriceOracle(priceOracle.address);
  console.log("#3 comptroller._setPriceOracle Done : ", priceOracle.address);

  const interestRateModelArgs = Object.values(INTEREST_RATE_MODEL);
  const interestRateModels = await deployInterestRateModels(interestRateModelArgs, deployer);
  console.log("#4 interestRateModels Deployed at: ", priceOracle.address);

  const cTokenLikes = await deployCTokens(
    underlying,
    interestRateModels,
    priceOracle,
    comptroller,
    deployer,
    overrides,
  );

  cTokenLikes.map((_ctoken, index) => {
    console.log(`#5-${index + 1} CTokens Deployed at: ', ${_ctoken.address}`);
  });

  const cTokens = new CTokens();
  underlying.forEach((u, idx) => {
    cTokens[u.cToken] = cTokenLikes[idx];
  });

  return {
    comptroller,
    priceOracle,
    interestRateModels,
    cTokens,
  };
}

async function deployCTokens(
  config: CTokenDeployArg[],
  irm: InterestRateModels,
  priceOracle: SimplePriceOracle,
  comptroller: Comptroller,
  deployer: SignerWithAddress,
  overrides?: Overrides,
): Promise<CTokenLike[]> {
  const cTokens: CTokenLike[] = [];
  for (const u of config) {
    const cTokenConf = CTOKEN[u.cToken];
    const cTokenArgs = cTokenConf.args as CTokenArgs;
    cTokenArgs.comptroller = comptroller.address;
    cTokenArgs.underlying = u.underlying || "0x00";
    cTokenArgs.interestRateModel = irm[cTokenConf.interestRateModel.name].address;
    cTokenArgs.admin = deployer.address;
    const cToken = await deployCToken(cTokenArgs, deployer, overrides);

    await comptroller._supportMarket(cToken.address, overrides);

    if (cTokenConf.type === CTokenType.CEther) {
      await priceOracle.setDirectPrice(cToken.address, u.underlyingPrice || 0, overrides);
    } else {
      await priceOracle.setUnderlyingPrice(cToken.address, u.underlyingPrice || 0, overrides);
    }

    if (u.collateralFactor) {
      await comptroller._setCollateralFactor(cToken.address, u.collateralFactor, overrides);
    }

    cTokens.push(cToken);
  }
  return cTokens;
}

export async function deployCToken(
  args: CTokenArgs,
  deployer: SignerWithAddress,
  overrides?: Overrides,
): Promise<CTokenLike> {
  return deployCErc20Immutable(args, deployer, overrides);
}

export async function deployComptroller(deployer: SignerWithAddress, admin: string, overrides?: Overrides): Promise<Comptroller> {
  return new Comptroller__factory(deployer).deploy(admin, overrides);
}

export async function deployUnitroller(deployer: SignerWithAddress, overrides?: Overrides): Promise<Unitroller> {
  return new Unitroller__factory(deployer).deploy(overrides);
}

export async function deployWhitePaperInterestRateModel(
  args: WhitePaperInterestRateModelArgs,
  deployer: SignerWithAddress,
  overrides?: Overrides,
): Promise<WhitePaperInterestRateModel> {
  return new WhitePaperInterestRateModel__factory(deployer).deploy(
    args.baseRatePerYear,
    args.multiplierPerYear,
    overrides,
  );
}

export async function deployJumpRateModelV2(
  args: JumpRateModelV2Args,
  deployer: SignerWithAddress,
  overrides?: Overrides,
): Promise<BaseJumpRateModelV2> {
  return new JumpRateModelV2__factory(deployer).deploy(
    args.baseRatePerYear,
    args.multiplierPerYear,
    args.jumpMultiplierPerYear,
    args.kink,
    args.owner,
    overrides,
  );
}

async function deployInterestRateModels(
  items: InterestRateModelConfig[],
  deployer: SignerWithAddress,
  overrides?: Overrides,
) {
  const models: InterestRateModels = {};
  let model;
  for (const item of items) {
    if ("owner" in item.args) {
      item.args.owner = deployer.address;
    }
    if (item.type === InterestRateModelType.WhitePaperInterestRateModel) {
      model = await deployWhitePaperInterestRateModel(
        item.args as WhitePaperInterestRateModelArgs,
        deployer,
        overrides,
      );
    } else {
      model = await deployJumpRateModelV2(item.args as JumpRateModelV2Args, deployer, overrides);
    }
    models[item.name] = model;
  }
  return models;
}

export async function deployPriceOracle(
  deployer: SignerWithAddress,
  overrides?: Overrides,
): Promise<SimplePriceOracle> {
  return new SimplePriceOracle__factory(deployer).deploy(overrides);
}

export async function deployTickOracle(
  deployer: SignerWithAddress,
  nfpManager: string,
  factory: string,
  overrides?: Overrides,
): Promise<SimpleTickOracle> {
  return new SimpleTickOracle__factory(deployer).deploy(nfpManager, factory, overrides);
}

export async function deployCErc20Immutable(
  args: CErc20Args,
  deployer: SignerWithAddress,
  overrides?: Overrides,
): Promise<CErc20Immutable> {
  return new CErc20Immutable__factory(deployer).deploy(
    args.underlying,
    args.comptroller,
    args.interestRateModel,
    args.name,
    args.symbol,
    args.reserveFactorMantissa,
    args.admin,
    overrides,
  );
}
