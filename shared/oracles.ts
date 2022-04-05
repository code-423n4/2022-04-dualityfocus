import _ from "lodash";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  UNI_V3_FACTORY, // same address on main and polygon
  UNI_V3_NFP_MANAGER, // same address on main and polygon
  UNI_V3_ROUTER1, // same address on main and polygon
  WMATIC_POLYGON,
  MATIC,
  WBTC,
  USDC,
  WETH,
  WETH_POLYGON,
  WBTC_POLYGON,
  USDC_POLYGON,
  USDT_POLYGON,
  DAI_POLYGON,
  USDC_WETH_v3_500_POLYGON,
  MATIC_USDC_v3_500_POLYGON,
  MATIC_WETH_v3_3000_POLYGON,
  USDC_USDT_v3_500_POLYGON,
  MATIC_WETH_v3_500_POLYGON,
  WBTC_WETH_v3_500_POLYGON,
  MATIC_USDC_v3_3000_POLYGON,
  WBTC_USDC_v3_3000_POLYGON,
  Chain,
  USDC_WETH_v3_500,
  WBTC_WETH_v3_3000,
  MATIC_WETH_v3_3000,
  WETH_MUMBAI,
  WMATIC_MUMBAI,
  MATIC_WETH_v3_10000_MUMBAI,
} from "../shared/constants";

import { deployMasterPriceOracle, deployTwapPriceOracle, deployUniV3LPVault } from "@duality/oracle-lp";

// this is all setup for polygon

const assetsMain = [MATIC, WBTC, USDC];

const poolsMain = [MATIC_WETH_v3_3000, WBTC_WETH_v3_3000, USDC_WETH_v3_500];

const assetsPolygon = [WMATIC_POLYGON, WBTC_POLYGON, USDC_POLYGON];

const poolsPolygon = [MATIC_WETH_v3_3000_POLYGON, WBTC_WETH_v3_500_POLYGON, USDC_WETH_v3_500_POLYGON];

const assetsMumbai = [WMATIC_MUMBAI];

const poolsMumbai = [MATIC_WETH_v3_10000_MUMBAI];

const assetsByChain = {
  [Chain.Mainnet]: assetsMain,
  [Chain.Polygon]: assetsPolygon,
  [Chain.Mumbai]: assetsMumbai,
};

const poolsByChain = {
  [Chain.Mainnet]: poolsMain,
  [Chain.Polygon]: poolsPolygon,
  [Chain.Mumbai]: poolsMumbai,
};

const wethAddrByChain = {
  [Chain.Mainnet]: WETH,
  [Chain.Polygon]: WETH_POLYGON,
  [Chain.Mumbai]: WETH_MUMBAI, // need to find this
};

export const setupOracles = async (
  deployer: SignerWithAddress,
  twapPeriod: number = 60,
  canAdminOverwrite: boolean = true,
  chain: Chain,
) => {
  // // deploy uni twap oracle

  const uniTwapOracle = await setupUniTwapOracle(deployer, twapPeriod, canAdminOverwrite, chain);
  const masterOracle = await deployMasterPriceOracle(
    deployer,
    assetsByChain[chain],
    _.times(assetsByChain[chain].length, _.constant(uniTwapOracle.address)),
    wethAddrByChain[chain],
    canAdminOverwrite,
  );

  return [masterOracle, uniTwapOracle];
};

export const setupUniTwapOracle = async (
  deployer: SignerWithAddress,
  twapPeriod: number = 60,
  canAdminOverwrite: boolean = true,
  chain: Chain,
) => {
  return deployTwapPriceOracle(
    deployer,
    assetsByChain[chain],
    poolsByChain[chain],
    twapPeriod,
    wethAddrByChain[chain],
    canAdminOverwrite,
  );
};

export const setupLpVault = async (deployer: SignerWithAddress, comptrollerAddress: string) => {
  return deployUniV3LPVault(deployer, UNI_V3_FACTORY, UNI_V3_NFP_MANAGER, UNI_V3_ROUTER1, comptrollerAddress);
};
