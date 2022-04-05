pragma solidity ^0.7.6;

import { PriceOracleInterface, CErc20Interface, CTokenInterface } from "../interfaces/CompoundInterfaces.sol";

contract SimplePriceOracle is PriceOracleInterface {
    address admin;
    mapping(address => uint256) prices;
    event PricePosted(
        address asset,
        uint256 previousPriceMantissa,
        uint256 requestedPriceMantissa,
        uint256 newPriceMantissa
    );

    constructor() {
        admin = msg.sender;
    }

    function getUnderlyingPrice(CTokenInterface cToken) public view override returns (uint256) {
        if (compareStrings(cToken.symbol(), "cETH")) {
            return 1e18;
        } else {
            return prices[address(CErc20Interface(address(cToken)).underlying())];
        }
    }

    function price(address underlying) public view override returns (uint256) {
        if (underlying == 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2) {
            return 1e18;
        } else {
            return prices[underlying];
        }
    }

    function setUnderlyingPrice(CTokenInterface cToken, uint256 underlyingPriceMantissa) public {
        address asset = address(CErc20Interface(address(cToken)).underlying());
        emit PricePosted(asset, prices[asset], underlyingPriceMantissa, underlyingPriceMantissa);
        prices[asset] = underlyingPriceMantissa;
    }

    function setDirectPrice(address asset, uint256 price) public {
        emit PricePosted(asset, prices[asset], price, price);
        prices[asset] = price;
    }

    // v1 price oracle interface for use as backing of proxy
    function assetPrices(address asset) external view returns (uint256) {
        return prices[asset];
    }

    function compareStrings(string memory a, string memory b) internal pure returns (bool) {
        return (keccak256(abi.encodePacked((a))) == keccak256(abi.encodePacked((b))));
    }
}
