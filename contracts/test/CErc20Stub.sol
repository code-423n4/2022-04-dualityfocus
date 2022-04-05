pragma solidity ^0.7.6;

contract CErc20Stub {
    address public underlying;

    bool public isLiquid;

    bool public repaySuccess;

    constructor(address _underlying) {
        underlying = _underlying;
    }

    function setIsLiquid(bool newIsLiquid) external {
        isLiquid = newIsLiquid;
    }

    function setRepaySuccess(bool newRepaySuccess) external {
        repaySuccess = newRepaySuccess;
    }

    function repayBorrowBehalf(address user, uint256 repayAmount) external returns (uint256) {
        user;
        if (!repaySuccess) {
            return 1;
        }
        (bool success, ) = underlying.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), repayAmount)
        );
        return success ? 0 : 1;
    }

    function borrowBehalf(address user, uint256 borrowAmount) external returns (uint256) {
        user;
        (bool success, ) = underlying.call(
            abi.encodeWithSignature("transfer(address,uint256)", msg.sender, borrowAmount)
        );
        return success && isLiquid ? 0 : 1;
    }
}
