// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract KILLFaucet is ReentrancyGuard {
    IERC20 public immutable killToken;

    mapping(address => bool) public hasClaimed;

    event TokensPulled(address indexed agent, uint256 amount);

    constructor(address _killToken) {
        killToken = IERC20(_killToken);
    }

    /**
     * @dev Pulls 10% of the current contract balance.
     * One time use per address. Any wallet can claim.
     */
    function pullKill() external nonReentrant {
        require(!hasClaimed[msg.sender], "Already pulled");

        uint256 contractBalance = killToken.balanceOf(address(this));
        require(contractBalance > 0, "Faucet empty");

        // Calculate 10% of current balance
        uint256 pullAmount = contractBalance / 10;
        require(pullAmount > 0, "Amount too small");

        hasClaimed[msg.sender] = true;

        require(killToken.transfer(msg.sender, pullAmount), "Transfer fail");

        emit TokensPulled(msg.sender, pullAmount);
    }
}