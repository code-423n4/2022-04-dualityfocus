import _ from "lodash";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  MasterPriceOracle__factory,
  UniswapTwapOracle__factory,
  UniV3LpVault__factory,
  FlashLoan__factory,
} from "../typechain";

export async function deployMasterPriceOracle(
  deployer: SignerWithAddress,
  tokens: string[],
  oracles: string[],
  wethAddress: string,
  canAdminOverwrite: boolean,
) {
  return new MasterPriceOracle__factory(deployer).deploy(
    tokens,
    oracles,
    wethAddress,
    deployer.address,
    canAdminOverwrite,
  );
}

export async function deployTwapPriceOracle(
  deployer: SignerWithAddress,
  tokens: string[],
  pools: string[],
  twapPeriod: number,
  wethAddress: string,
  nfpManager: string,
  factory: string,
  canAdminOverwrite: boolean,
) {
  return new UniswapTwapOracle__factory(deployer).deploy(
    tokens,
    pools,
    twapPeriod,
    wethAddress,
    nfpManager,
    factory,
    deployer.address,
    canAdminOverwrite,
  );
}

export async function deployUniV3LPVault(
  deployer: SignerWithAddress,
  factory: string,
  nfpManager: string,
  swapRouter: string,
  comptroller: string,
) {
  return new UniV3LpVault__factory(deployer).deploy(factory, nfpManager, swapRouter, comptroller);
}

export async function deployVaultFlashLoanReceiver(
  deployer: SignerWithAddress,
  addressProvider: string,
  lpVault: string,
) {
  return new FlashLoan__factory(deployer).deploy(addressProvider, lpVault);
}
