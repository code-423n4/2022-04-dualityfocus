import { CTokenType, InterestRateModelType } from "../src/enums";
import { parseUnits } from "ethers/lib/utils";
import { getERC20Decimals } from "./utils";
import {
  ZTokenSymbol,
  USDC,
  WETH,
  WBTC,
  MATIC,
  Token,
  chainAddrMappings,
  Chain,
  USDC_WETH_v3_500_POLYGON,
  MATIC_USDC_v3_3000_POLYGON,
  MATIC_USDC_v3_500_POLYGON,
  MATIC_WETH_v3_3000_POLYGON,
  MATIC_WETH_v3_500_POLYGON,
  USDC_USDT_v3_500_POLYGON,
  WBTC_USDC_v3_3000_POLYGON,
  WBTC_WETH_v3_500_POLYGON,
  USDC_WETH_v3_500,
  MATIC_WETH_v3_3000,
  WBTC_WETH_v3_3000,
} from "./constants";

export const defaultInterestRateModelConfig = {
  type: InterestRateModelType.JumpRateModelV2,
  args: {
    baseRatePerYear: "20000000000000000",
    multiplierPerYear: "180000000000000000",
    jumpMultiplierPerYear: "4000000000000000000",
    kink: "800000000000000000",
  },
};

export const interestRateModelConfigs: Partial<Record<ZTokenSymbol, any>> = {
  // put any non-default InterestRateModels here
  [ZTokenSymbol.zETH]: {
    type: InterestRateModelType.WhitePaperInterestRateModel,
    args: {
      baseRatePerYear: "20000000000000000",
      multiplierPerYear: "100000000000000000",
    },
  },
  [ZTokenSymbol.zUSDC]: {
    type: InterestRateModelType.JumpRateModelV2,
    args: {
      baseRatePerYear: "0",
      multiplierPerYear: "50000000000000000",
      jumpMultiplierPerYear: "1090000000000000000",
      kink: "800000000000000000",
    },
  },
  [ZTokenSymbol.zBTC]: {
    type: InterestRateModelType.JumpRateModelV2,
    args: {
      baseRatePerYear: "20000000000000000",
      multiplierPerYear: "225000000000000000",
      jumpMultiplierPerYear: "1000000000000000000",
      kink: "800000000000000000",
    },
  },
  [ZTokenSymbol.zMATIC]: {
    // using BTC params for now, can tweak
    type: InterestRateModelType.JumpRateModelV2,
    args: {
      baseRatePerYear: "20000000000000000",
      multiplierPerYear: "225000000000000000",
      jumpMultiplierPerYear: "1000000000000000000",
      kink: "800000000000000000",
    },
  },
};

export const comptrollerConfigs = {
  default: {
    closeFactor: parseUnits("0.5", 18).toString(),
    liquidationIncentive: parseUnits("1.08", 18),
  },
};

const defaultCTokenConfig = {
  decimals: 8,
};

export const cTokenConfigsFunc = (deployerAddr: string, chain: Chain) => {
  const addrMapping = chainAddrMappings[chain];
  const usdcAddr = addrMapping[Token.USDC];
  const wethAddr = addrMapping[Token.WETH];
  const wbtcAddr = addrMapping[Token.WBTC];
  const maticAddr = addrMapping[Token.MATIC];

  return {
    [ZTokenSymbol.zETH]: {
      ...defaultCTokenConfig,
      symbol: ZTokenSymbol.zETH,
      name: "foETH",
      underlying: wethAddr,
      collateralFactor: parseUnits("0.8", 18), // 80%
      initialExchangeRateMantissa: parseUnits("2", defaultCTokenConfig.decimals + getERC20Decimals(Token.WETH)),
      type: CTokenType.CErc20Delegator,
      price: parseUnits("1000", 18), // only used with simplePriceOracle for testing
      reserveFactorMantissa: "10000000000000000",
      admin: deployerAddr,
    },
    [ZTokenSymbol.zUSDC]: {
      ...defaultCTokenConfig,
      symbol: ZTokenSymbol.zUSDC,
      name: "foUSDC",
      underlying: usdcAddr,
      collateralFactor: parseUnits("0.8", 18), // 80%
      initialExchangeRateMantissa: parseUnits("2", defaultCTokenConfig.decimals + getERC20Decimals(Token.USDC)),
      type: CTokenType.CErc20Delegator,
      price: parseUnits("1000", 18), // only used with simplePriceOracle for testing
      reserveFactorMantissa: "05000000000000000",
      admin: deployerAddr,
    },
    [ZTokenSymbol.zBTC]: {
      ...defaultCTokenConfig,
      symbol: ZTokenSymbol.zBTC,
      name: "foBTC",
      underlying: wbtcAddr,
      collateralFactor: parseUnits("0.7", 18), // 70%
      initialExchangeRateMantissa: parseUnits("2", defaultCTokenConfig.decimals + getERC20Decimals(Token.WBTC)),
      type: CTokenType.CErc20Delegator,
      price: parseUnits("1000", 18), // only used with simplePriceOracle for testing
      reserveFactorMantissa: "10000000000000000",
      admin: deployerAddr,
    },
    [ZTokenSymbol.zMATIC]: {
      ...defaultCTokenConfig,
      symbol: ZTokenSymbol.zMATIC,
      name: "foMATIC",
      underlying: maticAddr,
      collateralFactor: parseUnits("0.5", 18), // 50%
      initialExchangeRateMantissa: parseUnits("2", defaultCTokenConfig.decimals + getERC20Decimals(Token.MATIC)),
      type: CTokenType.CErc20Delegator,
      price: parseUnits("1000", 18), // only used with simplePriceOracle for testing
      reserveFactorMantissa: "10000000000000000",
      admin: deployerAddr,
    },
  };
};

const poolCollateralFactorsMainnet = {
  [USDC_WETH_v3_500]: parseUnits("0.7", 18),
  [WBTC_WETH_v3_3000]: parseUnits("0.7", 18),
  [MATIC_WETH_v3_3000]: parseUnits("0.5", 18),
};

const poolCollateralFactorsPolygon = {
  [USDC_USDT_v3_500_POLYGON]: parseUnits("0.8", 18),
  [USDC_WETH_v3_500_POLYGON]: parseUnits("0.7", 18),
  [WBTC_WETH_v3_500_POLYGON]: parseUnits("0.7", 18),
  [WBTC_USDC_v3_3000_POLYGON]: parseUnits("0.7", 18),
  [MATIC_WETH_v3_500_POLYGON]: parseUnits("0.5", 18),
  [MATIC_USDC_v3_3000_POLYGON]: parseUnits("0.5", 18),
  [MATIC_USDC_v3_500_POLYGON]: parseUnits("0.5", 18),
  [MATIC_WETH_v3_3000_POLYGON]: parseUnits("0.5", 18),
};

export const poolCollateralFactorsByChain = {
  [Chain.Mainnet]: poolCollateralFactorsMainnet,
  [Chain.Polygon]: poolCollateralFactorsPolygon,
};
