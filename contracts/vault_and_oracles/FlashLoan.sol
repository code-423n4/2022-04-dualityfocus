pragma solidity ^0.7.6;
pragma abicoder v2;

import { IFlashLoanReceiver, ILendingPool, ILendingPoolAddressesProvider } from "../external/aave/AaveInterfaces.sol";
import { IERC20 } from "../external/openzeppelin/token/ERC20/IERC20.sol";
import { SafeMath } from "../external/openzeppelin/math/SafeMath.sol";

import { CErc20Interface } from "../interfaces/CompoundInterfaces.sol";
import "../interfaces/IUniV3LpVault.sol";

/** 
    !!!
    Never keep funds permanently on your FlashLoanReceiverBase contract as they could be 
    exposed to a 'griefing' attack, where the stored funds are used by an attacker.
    !!!
 */
contract FlashLoan is IFlashLoanReceiver {
    using SafeMath for uint256;

    ILendingPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
    ILendingPool public immutable override LENDING_POOL;
    IUniV3LpVault public immutable LP_VAULT;

    constructor(address _addressesProvider, address _lpVault) {
        ADDRESSES_PROVIDER = ILendingPoolAddressesProvider(_addressesProvider);
        LENDING_POOL = ILendingPool(ILendingPoolAddressesProvider(_addressesProvider).getLendingPool());
        LP_VAULT = IUniV3LpVault(_lpVault);
    }

    /**
        This function is called after your contract has received the flash loaned amount
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(LENDING_POOL), "Flashloan from untrusted lending pool");
        require(initiator == address(LP_VAULT), "Flashloan must be initiated from LP Vault");
        //
        // This contract now has the funds requested.
        // Your logic goes here.
        //

        IUniV3LpVault.FlashFocusParams memory focusParams = abi.decode(params, (IUniV3LpVault.FlashFocusParams));
        IERC20(assets[0]).approve(address(LP_VAULT), amounts[0]);
        focusParams.asset = assets[0];
        focusParams.amount = amounts[0];
        focusParams.premium = premiums[0];

        LP_VAULT.flashFocusCall(focusParams);

        // Approve the LendingPool contract allowance to *pull* the owed amount
        uint256 amountOwing = amounts[0].add(premiums[0]);
        IERC20(assets[0]).transferFrom(address(LP_VAULT), address(this), amountOwing);
        IERC20(assets[0]).approve(address(LENDING_POOL), amountOwing);

        return true;
    }
}
