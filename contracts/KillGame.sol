// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract KILLGame is ERC1155, ReentrancyGuard {
    // --- Constants ---
    uint256 public constant BURN_BPS = 666; 
    uint256 public constant TREASURY_BPS = 9334;
    uint256 public constant SPAWN_COST = 10; 
    uint256 public constant BOOST_REQUIRED = 666;
    uint256 public constant BOOST_RECOIL = 66;

    // --- State ---
    struct ReaperStack {
        uint256 birthBlock;
    }

    struct Cube {
        uint16 id;
        uint256 totalUnits;
    }

    // agent => tokenId => Stack data
    mapping(address => mapping(uint256 => ReaperStack)) public agentStacks;
    mapping(uint16 => Cube) public grid;
    uint256 public treasuryBalance;

    constructor() ERC1155("https://api.killgame.ai/metadata/{id}.json") {}

    // --- Actions ---

    function kill(address target, uint16 cube, uint256 amountToKill, bool boosted) external nonReentrant returns (uint256 bountyPaid) {
        uint256 tokenId = boosted ? uint256(cube) + 216 : uint256(cube);
        uint256 minRequired = boosted ? amountToKill * BOOST_REQUIRED : amountToKill * 2;
        
        require(balanceOf(msg.sender, tokenId) >= minRequired, "Insufficient Force");
        
        bountyPaid = getPendingBounty(target, tokenId);
        uint256 recoil = boosted ? amountToKill * BOOST_RECOIL : amountToKill;

        _burn(target, tokenId, amountToKill);
        _burn(msg.sender, tokenId, recoil);
        
        uint256 burnAmt = (bountyPaid * BURN_BPS) / 10000;
        uint256 netBounty = bountyPaid - burnAmt;
        
        treasuryBalance -= bountyPaid;
        // Logic for token transfer of netBounty would go here
        return netBounty;
    }

    function spawn(uint16 cube, uint256 units, bool boosted) external payable {
        uint256 tokenId = boosted ? uint256(cube) + 216 : uint256(cube);
        uint256 totalCost = units * SPAWN_COST;
        
        // Note: Real implementation requires ERC20.transferFrom for SPAWN_COST
        treasuryBalance += (totalCost * TREASURY_BPS) / 10000;
        
        _mint(msg.sender, tokenId, units, "");
        agentStacks[msg.sender][tokenId].birthBlock = block.number;
    }

    function move(uint16 fromCube, uint16 toCube, uint256 units, bool boosted) external {
        uint256 fId = boosted ? uint256(fromCube) + 216 : uint256(fromCube);
        uint256 tId = boosted ? uint256(toCube) + 216 : uint256(toCube);

        _safeTransferFrom(msg.sender, msg.sender, fId, units, "");
        
        agentStacks[msg.sender][tId].birthBlock = block.number;
    }

    // --- View ---

    function getPendingBounty(address agent, uint256 tokenId) public view returns (uint256) {
        uint256 age = block.number - agentStacks[agent][tokenId].birthBlock;
        return (treasuryBalance * age) / 10000; 
    }

    // Required override for ERC1155
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
