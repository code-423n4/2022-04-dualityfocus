import { config, ethers, network } from "hardhat";
import { BigNumber, BigNumberish } from "ethers";
import { BigNumber as BigNumberJs } from "bignumber.js";
import { erc20BalanceSlot, Token } from "../shared/constants";

export async function giveERC20Balance(userAddress: string, token: Token, tokenAddress: string, balance: BigNumberish) {
  const index = ethers.utils
    .solidityKeccak256(
      ["uint256", "uint256"],
      [userAddress, erc20BalanceSlot[token]], // key, slot
    )
    .toString();
  const balanceByteString = ethers.utils
    .hexlify(ethers.utils.zeroPad(BigNumber.from(balance).toHexString(), 32))
    .toString();

  await ethers.provider.send("hardhat_setStorageAt", [tokenAddress, index, balanceByteString]);
  await ethers.provider.send("evm_mine", []);
}

export function isSimilar(number1: string, number2: string, precision: number = 4) {
  const error = 1 / 10 ** precision;
  if (number2 === number1) return true;
  return new BigNumberJs(number1).div(new BigNumberJs(number2)).minus(1).abs().lt(error);
}

export function encodePath(tokenAddresses: string[], fees: number[]) {
  const FEE_SIZE = 3;

  if (tokenAddresses.length != fees.length + 1) {
    throw new Error("path/fee lengths do not match");
  }

  let encoded = "0x";
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += tokenAddresses[i].slice(2);
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, "0");
  }
  // encode the final token
  encoded += tokenAddresses[tokenAddresses.length - 1].slice(2);

  return encoded.toLowerCase();
}

export async function resetChain() {
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: config.networks.hardhat.forking!.url,
          blockNumber: config.networks.hardhat.forking!.blockNumber,
        },
      },
    ],
  });
}
