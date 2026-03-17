// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract KILLFaucet is ReentrancyGuard {
    IERC20 public immutable killToken;
    
    uint256 public constant MIN_AGENT_BALANCE = 1 * 10**18;
    
    mapping(address => bool) public hasClaimed;

    event TokensPulled(address indexed agent, uint256 amount);

    constructor(address _killToken) {
        killToken = IERC20(_killToken);
    }

    /**
     * @dev Pulls 10% of the current contract balance.
     * One time use per address. Requires 1 KILL balance to qualify.
     */
    function pullKill() external nonReentrant {
        require(!hasClaimed[msg.sender], "Already pulled");
        require(killToken.balanceOf(msg.sender) >= MIN_AGENT_BALANCE, "Not an agent");
        
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