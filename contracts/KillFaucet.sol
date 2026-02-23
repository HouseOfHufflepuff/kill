// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract KILLFaucet {
    IERC20 public immutable killToken;
    
    uint256 public constant PULL_AMOUNT = 666000 * 10**18;
    uint256 public constant MIN_AGENT_BALANCE = 1 * 10**18;
    
    mapping(address => bool) public hasClaimed;

    event TokensPulled(address indexed agent, uint256 amount);

    constructor(address _killToken) {
        killToken = IERC20(_killToken);
    }

    /**
     * @dev Simple pull: One time use per address. 
     * Requires the caller to hold at least 1 KILL to qualify as an agent.
     */
    function pullKill() external {
        require(!hasClaimed[msg.sender], "Already pulled");
        require(killToken.balanceOf(msg.sender) >= MIN_AGENT_BALANCE, "Not an agent");
        require(killToken.balanceOf(address(this)) >= PULL_AMOUNT, "Faucet empty");

        hasClaimed[msg.sender] = true;
        require(killToken.transfer(msg.sender, PULL_AMOUNT), "Transfer fail");

        emit TokensPulled(msg.sender, PULL_AMOUNT);
    }
}