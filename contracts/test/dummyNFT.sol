pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract DummyNFT is ERC721 {
    uint256 public _currentTokenId = 0; //Token ID here will start from 1

    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

    /**

     * @dev Mints a token to an address with a tokenURI.
     * @param _to address of the future owner of the token
     */
    function mintTo(address _to) public {
        uint256 newTokenId = _getNextTokenId();
        _mint(_to, newTokenId);
        _incrementTokenId();
    }

    /**
     * @dev calculates the next token ID based on value of _currentTokenId
     * @return uint256 for the next token ID
     */
    function _getNextTokenId() private view returns (uint256) {
        return _currentTokenId + 1;
    }

    /**
     * @dev increments the value of _currentTokenId
     */
    function _incrementTokenId() private {
        _currentTokenId++;
    }
}
