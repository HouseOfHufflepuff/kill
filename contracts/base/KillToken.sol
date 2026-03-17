// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KILLToken is ERC20Capped, Ownable {
    // 666,000,000,000 with 18 decimals
    uint256 public constant HARD_CAP = 666000000000 * 10**18;

    constructor()
        ERC20("KILL", "KILL")
        ERC20Capped(HARD_CAP)
        Ownable(msg.sender)
    {
        _mint(msg.sender, HARD_CAP);
    }
}
