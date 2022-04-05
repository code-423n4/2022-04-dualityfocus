import { BigNumberish } from "ethers";

import {
  BaseJumpRateModelV2,
  CErc20,
  CErc20Immutable,
  Comptroller,
  SimplePriceOracle,
  WhitePaperInterestRateModel,
} from "../typechain";

import { CTokenType, InterestRateModelType } from "./enums";

export interface CompoundV2 {
  readonly comptroller: Comptroller;
  readonly priceOracle: SimplePriceOracle;
  readonly interestRateModels: InterestRateModels;
  readonly cTokens: CTokens;
}

export interface InterestRateModels {
  [key: string]: WhitePaperInterestRateModel | BaseJumpRateModelV2;
}

export class CTokens {
  [key: string]: CTokenLike;

  set cETH(value: CTokenLike) {
    this.cEth = value;
  }
}

export type CTokenLike = CErc20 | CErc20Immutable;

export interface CEthArgs {
  comptroller: string;
  interestRateModel: string;
  initialExchangeRateMantissa: string;
  name: string;
  symbol: string;
  decimals: number;
  admin: string;
}

export interface CErc20Args {
  underlying: string;
  comptroller: string;
  interestRateModel: string;
  name: string;
  symbol: string;
  reserveFactorMantissa: string;
  admin: string;
}

export type CTokenArgs = CErc20Args;

export type WhitePaperInterestRateModelArgs = {
  baseRatePerYear: string;
  multiplierPerYear: string;
};

export type BaseJumpRateModelV2Args = {
  baseRatePerYear: string;
  multiplierPerYear: string;
  jumpMultiplierPerYear: string;
  kink: string;
  owner: string;
};

export type LegacyJumpRateModelV2Args = BaseJumpRateModelV2Args;

export type JumpRateModelV2Args = BaseJumpRateModelV2Args;

export interface InterestRateModelConfigs {
  readonly [key: string]: InterestRateModelConfig;
}

export interface InterestRateModelConfig {
  name: string;
  type: InterestRateModelType;
  args: WhitePaperInterestRateModelArgs | LegacyJumpRateModelV2Args | JumpRateModelV2Args;
}

export interface CTokenConfigs {
  readonly [key: string]: CTokenConfig;
}

export interface CTokenConfig {
  symbol: string;
  type: CTokenType;
  args: CEthArgs | CErc20Args;
  interestRateModel: InterestRateModelConfig;
}

export interface CTokenDeployArg {
  cToken: string;
  underlying?: string;
  underlyingPrice?: BigNumberish;
  collateralFactor?: BigNumberish;
}
