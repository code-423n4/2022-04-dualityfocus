import _ from "lodash";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  USDC,
  WETH,
  USDC_WETH_v3_500,
  UNI_V3_FACTORY,
  UNI_V3_NFP_MANAGER,
  UNI_V3_ROUTER1,
  AAVE_ADDRESSES_PROVIDER,
} from "../shared/constants";

import { ComptrollerStub, CErc20Stub } from "../typechain";
import {
  deployMasterPriceOracle,
  deployTwapPriceOracle,
  deployUniV3LPVault,
  deployVaultFlashLoanReceiver,
} from "../shared/deployment";

export const setupOracles = async (
  deployer: SignerWithAddress,
  twapPeriod: number = 60,
  canAdminOverwrite: boolean = true,
) => {
  // // deploy uni twap oracle
  const uniTwapOracle = await setupUniTwapOracle(deployer, twapPeriod, canAdminOverwrite);
  const masterOracle = await deployMasterPriceOracle(
    deployer,
    [USDC],
    [uniTwapOracle.address],
    WETH,
    canAdminOverwrite,
  );

  return [masterOracle, uniTwapOracle];
};

export const setupUniTwapOracle = async (
  deployer: SignerWithAddress,
  twapPeriod: number = 60,
  canAdminOverwrite: boolean = true,
) => {
  return deployTwapPriceOracle(
    deployer,
    [USDC],
    [USDC_WETH_v3_500],
    twapPeriod,
    WETH,
    UNI_V3_NFP_MANAGER,
    UNI_V3_FACTORY,
    canAdminOverwrite,
  );
};

export const setupComptrollerStub = async (deployer: SignerWithAddress) => {
  const comptrollerStubFactory = await ethers.getContractFactory("ComptrollerStub", deployer);
  const comptrollerStub = <ComptrollerStub>await comptrollerStubFactory.deploy();
  return comptrollerStub;
};

export const setupCErc20Stub = async (deployer: SignerWithAddress, underlying: string) => {
  const CErc20StubFactory = await ethers.getContractFactory("CErc20Stub", deployer);
  const CErc20Stub = <CErc20Stub>await CErc20StubFactory.deploy(underlying);
  return CErc20Stub;
};

export const setupLpVault = async (deployer: SignerWithAddress, comptrollerStub: ComptrollerStub | undefined) => {
  if (!comptrollerStub) {
    comptrollerStub = await setupComptrollerStub(deployer);
  }
  return deployUniV3LPVault(deployer, UNI_V3_FACTORY, UNI_V3_NFP_MANAGER, UNI_V3_ROUTER1, comptrollerStub.address);
};

export const setupVaultFlashLoanReceiver = async (deployer: SignerWithAddress, lpVault: string) => {
  return deployVaultFlashLoanReceiver(deployer, AAVE_ADDRESSES_PROVIDER, lpVault);
};
