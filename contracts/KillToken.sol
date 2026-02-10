// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KILLToken is ERC20Capped, Ownable {
    // 666,666,666 with 18 decimals
    uint256 public constant HARD_CAP = 666666666 * 10**18;

    constructor() 
        ERC20("KILL", "KILL") 
        ERC20Capped(HARD_CAP) 
        Ownable(msg.sender) 
    {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}