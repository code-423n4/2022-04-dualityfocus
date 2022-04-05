import _ from "lodash";
import { ethers } from "hardhat";
import {
  CTokenInterface__factory,
  deployComptroller,
  deployCToken,
  deployJumpRateModelV2,
  deployUnitroller,
  deployWhitePaperInterestRateModel,
  JumpRateModelV2Args,
  LegacyJumpRateModelV2Args,
  WhitePaperInterestRateModelArgs,
  deployUniV3LPVault,
  deployVaultFlashLoanReceiver,
  UniV3LpVault,
} from "../src";
import { CTokenType, InterestRateModelType } from "../src/enums";
import {
  ZTokenSymbol,
  UNI_V3_NFP_MANAGER,
  UNI_V3_FACTORY,
  UNI_V3_ROUTER1,
  Token,
  chainAddrMappings,
  Chain,
  AAVE_ADDRESSES_PROVIDER_BY_CHAIN,
} from "./constants";
import { getERC20Decimals } from "./utils";
import { abi as COMPTROLLER_ABI } from "../artifacts/contracts/compound_rari_fork/Comptroller.sol/Comptroller.json";
import { abi as ERC20_ABI } from "./abis/ERC20.json";
import {
  comptrollerConfigs,
  cTokenConfigsFunc,
  defaultInterestRateModelConfig,
  interestRateModelConfigs,
} from "./configs";
import { Contract } from "ethers";
import { any } from "hardhat/internal/core/params/argumentTypes";

export const launchCTokens = async (
  inputs: any[],
  deployer: any,
  comptroller: any,
  debug: boolean = false,
  oracle?: any,
) => {
  const cTokenObj: Record<string, any> = {};
  for (const element of inputs) {
    const irm = await setupInterestRateModel(deployer, element.symbol);
    if (debug) console.log("InterestRateModel: ", irm.address);
    const obj = await launchCToken(element, deployer, comptroller, irm, debug, oracle);

    const symbolStr = element.symbol as string;
    cTokenObj[symbolStr] = obj;
  }

  return cTokenObj;
};

export const launchCToken = async (
  input: any,
  deployer: any,
  comptroller: any,
  irm: any,
  debug: boolean = false,
  oracle?: any,
) => {
  const args = await getCTokenArgs(input, deployer, comptroller, irm, !!oracle);

  const cToken = await deployCToken(args, deployer);

  if (debug) console.log("deployed cToken: ", cToken.address);

  const tx = await comptroller._supportMarket(cToken.address);
  await tx.wait();

  if (debug) console.log("called SupportMarket");

  if (oracle && input.price) {
    const tx3 = await oracle.setUnderlyingPrice(cToken.address, input.price);
    await tx3.wait();
  }

  if (input.collateralFactor) {
    const tx4 = await comptroller._setCollateralFactor(cToken.address, input.collateralFactor);
    await tx4.wait();
    if (debug) console.log("called setCollateralFactor");
  }

  return cToken;
};

export const getCTokenArgs = async (input: any, deployer: any, comptroller: any, irm: any, includePrice?: boolean) => {
  const cTokenArgs: any = {
    underlying: input.underlying,
    comptroller: comptroller.address,
    interestRateModel: irm.address,
    initialExchangeRateMantissa: input.initialExchangeRateMantissa,
    name: input.name,
    symbol: input.symbol, 
    reserveFactorMantissa: input.reserveFactorMantissa,
    admin: input.admin
  };

  if (includePrice) {
    cTokenArgs.price = input.price;
  }

  return cTokenArgs;
};

export const setupComptrollerAndLPVault = async (
  deployer: any,
  admin: any,
  oracle: any,
  chain: Chain = Chain.Mainnet,
): Promise<[Contract, UniV3LpVault]> => {
  const comptroller = await deployComptroller(deployer, admin);

  const uniV3LpVault = await deployUniV3LPVault(
    deployer,
    UNI_V3_FACTORY, // Uni V3 addresses are same per chain
    UNI_V3_NFP_MANAGER,
    UNI_V3_ROUTER1,
    comptroller.address,
  );
  const flashLoanReceiver = await deployVaultFlashLoanReceiver(
    deployer,
    AAVE_ADDRESSES_PROVIDER_BY_CHAIN[chain],
    uniV3LpVault.address,
  );

  let tx;
  tx = await uniV3LpVault._setFlashLoan(flashLoanReceiver.address);
  await tx.wait();
  tx = await comptroller._setUniV3LpVault(uniV3LpVault.address);
  await tx.wait();

  tx = await comptroller._setPriceOracle(oracle.address);
  await tx.wait();

  const defaultComptrollerConfig = comptrollerConfigs.default;

  // comptroller default values
  tx = await comptroller._setCloseFactor(defaultComptrollerConfig.closeFactor);
  await tx.wait();
  tx = await comptroller._setLiquidationIncentive(defaultComptrollerConfig.liquidationIncentive);
  await tx.wait();

  return [comptroller, uniV3LpVault];
  // return comptroller;
};

export const setupInterestRateModel = async (deployer: any, symbol: ZTokenSymbol) => {
  const config = interestRateModelConfigs[symbol] || defaultInterestRateModelConfig;
  // by symbol, look up in configs
  const args = {
    ...config.args,
    owner: deployer.address,
  };
  switch (config.type) {
    case InterestRateModelType.WhitePaperInterestRateModel:
      // handle jump rate model V2
      return deployWhitePaperInterestRateModel(args as WhitePaperInterestRateModelArgs, deployer);
    case InterestRateModelType.JumpRateModelV2:
      return deployJumpRateModelV2(args as JumpRateModelV2Args, deployer);
    default:
      throw "No Valid Interest Rate Model Type Given";
  }
};

export const setupTokens = async (
  deployer: any,
  comptroller: any,
  chain: Chain = Chain.Mainnet,
  debug: boolean = false,
) => {
  // Deploy cTokens
  const ctokenArgs = createCTokenArgs(deployer.address, chain);
  const { zETH, zUSDC, zBTC, zMATIC } = await launchCTokens(ctokenArgs, deployer, comptroller, debug);
  return createErc20Info(zETH, zUSDC, zBTC, zMATIC, chain);
};

export const setupTokensWOracle = async (
  deployer: any,
  comptroller: any,
  oracle: any,
  chain: Chain = Chain.Mainnet,
  debug: boolean = false,
) => {
  // Deploy cTokens w/ price
  const ctokenArgs = createCTokenArgs(deployer.address, chain);
  const { zETH, zUSDC, zBTC, zMATIC } = await launchCTokens(ctokenArgs, deployer, comptroller, debug, oracle);
  return createErc20Info(zETH, zUSDC, zBTC, zMATIC, chain);
};

const createCTokenArgs = (deployerAddr: string, chain: Chain) => {
  const ctokenArgs: any[] = [
    cTokenConfigsFunc(deployerAddr, chain)[ZTokenSymbol.zETH],
    cTokenConfigsFunc(deployerAddr, chain)[ZTokenSymbol.zUSDC],
    cTokenConfigsFunc(deployerAddr, chain)[ZTokenSymbol.zBTC],
    cTokenConfigsFunc(deployerAddr, chain)[ZTokenSymbol.zMATIC],
  ];

  return ctokenArgs;
};

const createErc20Info = (zETH: any, zUSDC: any, zBTC: any, zMATIC: any, chain: Chain) => {
  const addrMapping = chainAddrMappings[chain];
  const usdcAddr = addrMapping[Token.USDC];
  const wethAddr = addrMapping[Token.WETH];
  const wbtcAddr = addrMapping[Token.WBTC];
  const maticAddr = addrMapping[Token.MATIC];

  const usdcToken = new ethers.Contract(usdcAddr, ERC20_ABI);
  const wethToken = new ethers.Contract(wethAddr, ERC20_ABI);
  const wbtcToken = new ethers.Contract(wbtcAddr, ERC20_ABI);
  const maticToken = new ethers.Contract(maticAddr, ERC20_ABI);

  return {
    [Token.WETH]: {
      token: wethToken,
      cToken: zETH,
      decimals: getERC20Decimals(Token.WETH),
      tokenEnum: Token.WETH,
    },
    [Token.USDC]: {
      token: usdcToken,
      cToken: zUSDC,
      decimals: getERC20Decimals(Token.USDC),
      tokenEnum: Token.USDC,
    },
    [Token.WBTC]: {
      token: wbtcToken,
      cToken: zBTC,
      decimals: getERC20Decimals(Token.WBTC),
      tokenEnum: Token.WBTC,
    },
    [Token.MATIC]: {
      token: maticToken,
      cToken: zMATIC,
      decimals: getERC20Decimals(Token.MATIC),
      tokenEnum: Token.MATIC,
    },
  };
};

export const debugUserPositions = async (user: any, comptroller: any) => {
  console.log(`User ${user.address} positions`);

  let ctokenDebugInfo: { [key: string]: any } = {};
  let ctokens = await comptroller.getAssetsIn(user.address);
  const promises = _.map(ctokens, async (ctoken: any) => {
    let ctokenContract = await CTokenInterface__factory.connect(ctoken, user);
    // @ts-ignore
    const symbol = await ctokenContract.symbol();
    // const underlyingDecimals = getERC20Decimals(symbol);
    let [errorCode, cTokenBalance, borrowBalance, exchangeRateMantissa] = await ctokenContract.getAccountSnapshot(
      user.address,
    );
    ctokenDebugInfo[symbol] = {
      "cToken balance": ethers.utils.formatUnits(cTokenBalance, 8).toString(),
      // "borrow balance": ethers.utils.formatUnits(borrowBalance, underlyingDecimals).toString(),
      // "exchange rate": ethers.utils.formatUnits(exchangeRateMantissa, 18 - 8 + underlyingDecimals).toString(),
    };
  });
  await Promise.all(promises);
  console.table(ctokenDebugInfo);

  let [errorCode, liquidity, shortfall] = await comptroller.getAccountLiquidity(user.address);
  console.log("User total liquidity:", liquidity.toString());
  console.log("User total shortfall:", shortfall.toString());
};
