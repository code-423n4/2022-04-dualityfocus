import { BigNumberish, Contract } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

export interface BorrowScenario {
  user: SignerWithAddress;
  collateralCToken: Contract;
  collateralAmount: BigNumberish;
  borrowCToken: Contract;
  borrowAmount: BigNumberish;
  borrowSupplyAvailable: BigNumberish;
}
