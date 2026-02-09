// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KILLToken is ERC20Capped, Ownable {
    // In OZ v5, Ownable requires the initialOwner address
    constructor(uint256 cap, address initialOwner) 
        ERC20("KILL", "KILL") 
        ERC20Capped(cap) 
        Ownable(initialOwner) 
    {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
