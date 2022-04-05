import { nonStandardERC20Decimals, Token } from "../shared/constants";

export function getERC20Decimals(symbol: Token): number {
  const isUndefined = nonStandardERC20Decimals[symbol] == undefined;
  const returnValue: number = isUndefined ? 18 : (nonStandardERC20Decimals[symbol] as number);
  return returnValue;
}
