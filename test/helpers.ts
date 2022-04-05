import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { BorrowScenario } from "./types";
import { USDC, WETH } from "../shared/constants";
import { Contract } from "ethers";

export const setupBorrow = async (comptroller: Contract, admin: SignerWithAddress, scenario: BorrowScenario) => {
  let { user, collateralCToken, collateralAmount, borrowCToken, borrowAmount, borrowSupplyAvailable } = scenario;

  await comptroller.connect(admin).enterMarkets([borrowCToken.address]);
  await comptroller.connect(user).enterMarkets([collateralCToken.address, borrowCToken.address]);

  // prepare borrowable supply
  await borrowCToken.connect(admin).mintBehalf(admin.address, borrowSupplyAvailable);

  // mint some collateral
  await collateralCToken.connect(admin).mintBehalf(user.address, collateralAmount);

  // borrow against collateral
  await borrowCToken.connect(admin).borrowBehalf(user.address, borrowAmount);
};

export const mintFullRangeUsdcWeth = async (
  user: SignerWithAddress,
  contract: Contract,
  blockNumber: number,
  amount0: string,
  amount1: string,
  fee: number = 500,
) => {
  const mintParams = {
    token0: USDC,
    token1: WETH,
    fee: fee,
    tickLower: -887220,
    tickUpper: 887220,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: 1,
    amount1Min: 1,
    recipient: user.address,
    deadline: (await ethers.provider.getBlock(blockNumber)).timestamp + 200,
  };

  const tx = await contract.connect(user).mint(mintParams);
  await tx.wait();
};

export const sendNFT = async (nftContract: Contract, user: SignerWithAddress, to: string, tokenId: number) => {
  return nftContract.connect(user)["safeTransferFrom(address,address,uint256)"](user.address, to, tokenId);
};
