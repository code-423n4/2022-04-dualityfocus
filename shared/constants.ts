export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
export const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
export const MATIC = "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0";
export const USDC_ETH_V2_LP = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";

export const UNI_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
export const UNI_V3_ROUTER1 = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export const UNI_V3_ROUTER2 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";

export const UNI_V3_NFP_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

export const cUSDC = "0x39aa39c021dfbae8fac545936693ac917d5e7563";

export const AAVE_ADDRESSES_PROVIDER = "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5";

export enum ZTokenSymbol {
  zETH = "zETH",
  zUSDC = "zUSDC",
  zBTC = "zBTC",
  zMATIC = "zMATIC",
}

export enum Token {
  USDC = "usdc",
  USDT = "usdt",
  WETH = "weth",
  WBTC = "wbtc",
  MATIC = "matic",
}

export const erc20BalanceSlot: Partial<Record<Token, number>> = {
  [Token.USDC]: 9,
  [Token.WETH]: 3,
  [Token.WBTC]: 0,
};

export const nonStandardERC20Decimals: Partial<Record<Token, number>> = {
  [Token.USDC]: 6,
  [Token.USDT]: 6,
  [Token.WBTC]: 8,
};

export const MATIC_WETH_v3_3000 = "0x290A6a7460B308ee3F19023D2D00dE604bcf5B42";
export const WBTC_WETH_v3_3000 = "0xCBCdF9626bC03E24f779434178A73a0B4bad62eD";
export const USDC_WETH_v3_500 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";

//// POLYGON ////

// * Matic
// * WETH
// * WBTC
// * USDC
// * USDT
// * DAI

// * USDC/WETH 0.05%
// * MATIC/USDC 0.05%
// * MATIC/WETH 0.3%
// * USDC/USDT 0.05%
// * MATIC/WETH 0.05%
// * WBTC/WETH 0.05%
// * MATIC/USDC 0.3%

export const WMATIC_POLYGON = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
export const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
export const WBTC_POLYGON = "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";
export const USDC_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
export const USDT_POLYGON = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
export const DAI_POLYGON = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";

export const USDC_WETH_v3_500_POLYGON = "0x45dda9cb7c25131df268515131f647d726f50608";
export const MATIC_USDC_v3_500_POLYGON = "0xa374094527e1673a86de625aa59517c5de346d32";
export const MATIC_WETH_v3_3000_POLYGON = "0x167384319b41f7094e62f7506409eb38079abff8";
export const USDC_USDT_v3_500_POLYGON = "0x3f5228d0e7d75467366be7de2c31d0d098ba2c23";
export const MATIC_WETH_v3_500_POLYGON = "0x86f1d8390222a3691c28938ec7404a1661e618e0";
export const WBTC_WETH_v3_500_POLYGON = "0x50eaedb835021e4a108b7290636d62e9765cc6d7";
export const MATIC_USDC_v3_3000_POLYGON = "0x88f3c15523544835ff6c738ddb30995339ad57d6";
export const WBTC_USDC_v3_3000_POLYGON = "0x847b64f9d3a95e977d157866447a5c0a5dfa0ee5";

export const WETH_MUMBAI = "0x3C68CE8504087f89c640D02d133646d98e64ddd9";
export const USDC_MUMBAI = "0x2058A9D7613eEE744279e3856Ef0eAda5FCbaA7e";
export const USDT_MUMBAI = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
export const WMATIC_MUMBAI = "0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889";
export const WBTC_MUMBAI = "0x0d787a4a1548f673ed375445535a6c7A1EE56180";

export const MATIC_WETH_v3_10000_MUMBAI = "0x99D59d73bAd8BE070FeA364717400043490866c9"; // 1% fee MATIC/WETH
export const MATIC_WETH_v3_3000_MUMBAI = "0x765fdb41ea7fd9ff26c8dd4eea20a4248f106622"; // 0.3% fee MATIC/WETH
export const MATIC_WETH_v3_500_MUMBAI = "0xc1FF5D622aEBABd51409e01dF4461936b0Eb4E43"; // 0.05% fee MATIC/WETH

export enum Chain {
  Polygon = "polygon",
  Mumbai = "mumbai",
  Mainnet = "mainnet",
}

const mainnetAddrMapping: Record<Token, string> = {
  [Token.USDC]: USDC,
  [Token.USDT]: USDT,
  [Token.WETH]: WETH,
  [Token.WBTC]: WBTC,
  [Token.MATIC]: MATIC,
};

const polygonAddrMapping: Record<Token, string> = {
  [Token.USDC]: USDC_POLYGON,
  [Token.USDT]: USDT_POLYGON,
  [Token.WETH]: WETH_POLYGON,
  [Token.WBTC]: WBTC_POLYGON,
  [Token.MATIC]: WMATIC_POLYGON,
};

const mumbaiAddrMapping: Record<Token, string> = {
  [Token.USDC]: USDC_MUMBAI,
  [Token.USDT]: USDT_MUMBAI,
  [Token.WETH]: WETH_MUMBAI,
  [Token.WBTC]: WBTC_MUMBAI,
  [Token.MATIC]: WMATIC_MUMBAI,
};

export const chainAddrMappings: Record<Chain, Record<Token, string>> = {
  [Chain.Mainnet]: mainnetAddrMapping,
  [Chain.Polygon]: polygonAddrMapping,
  [Chain.Mumbai]: mumbaiAddrMapping,
};

export const AAVE_ADDRESSES_PROVIDER_BY_CHAIN = {
  [Chain.Mainnet]: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
  [Chain.Polygon]: "0xd05e3E715d945B59290df0ae8eF85c1BdB684744",
  [Chain.Mumbai]: "0x178113104fEcbcD7fF8669a0150721e231F0FD4B",
};
