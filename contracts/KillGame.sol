// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KILLGame is ERC1155, ReentrancyGuard, Ownable {
    // --- Events ---
    event Spawned(address indexed agent, uint256 indexed tokenId, uint256 units);
    event Killed(address indexed attacker, address indexed target, uint256 tokenId, uint256 unitsKilled, uint256 bountyPaid);
    event Moved(address indexed agent, uint256 fromTokenId, uint256 toTokenId, uint256 units);

    // --- Constants ---
    uint256 public constant BURN_BPS = 666; 
    uint256 public constant TREASURY_BPS = 9334;
    uint256 public constant SPAWN_COST = 10 * 10**18;
    uint256 public constant BOOST_REQUIRED = 666;
    uint256 public constant BOOST_RECOIL = 66;
    uint16 public constant GRID_SIZE = 6; // 6x6x6 = 216 cubes

    // --- State ---
    IERC20 public immutable killToken;
    uint256 public treasuryBalance;

    struct ReaperStack {
        uint256 birthBlock;
    }

    mapping(address => mapping(uint256 => ReaperStack)) public agentStacks;
    mapping(uint256 => address[]) private cubeOccupants;
    mapping(uint256 => mapping(address => bool)) private isOccupying;

    constructor(address _tokenAddress) 
        ERC1155("https://api.killgame.ai/metadata/{id}.json") 
        Ownable(msg.sender)
    {
        killToken = IERC20(_tokenAddress);
    }

    // --- Actions ---

    function kill(address target, uint16 cube, uint256 amountToKill, bool boosted) external nonReentrant returns (uint256 netBounty) {
        uint256 tokenId = boosted ? uint256(cube) + 216 : uint256(cube);
        uint256 attackerPower = boosted ? amountToKill * BOOST_REQUIRED : amountToKill * 2;
        
        require(balanceOf(msg.sender, tokenId) >= attackerPower, "Insufficient Force");
        require(balanceOf(target, tokenId) >= amountToKill, "Target stack too small");
        
        uint256 totalBounty = getPendingBounty(target, tokenId);
        uint256 recoil = boosted ? amountToKill * BOOST_RECOIL : amountToKill;

        _burn(target, tokenId, amountToKill);
        _burn(msg.sender, tokenId, recoil);
        
        uint256 burnAmt = (totalBounty * BURN_BPS) / 10000;
        netBounty = totalBounty - burnAmt;
        
        treasuryBalance -= totalBounty;
        require(killToken.transfer(msg.sender, netBounty), "Bounty Transfer Failed");
        
        emit Killed(msg.sender, target, tokenId, amountToKill, netBounty);
        return netBounty;
    }

    function spawn(uint16 cube, uint256 units, bool boosted) external nonReentrant {
        require(cube > 0 && cube <= 216, "Invalid Cube");
        uint256 tokenId = boosted ? uint256(cube) + 216 : uint256(cube);
        uint256 totalCost = units * SPAWN_COST;
        
        require(killToken.transferFrom(msg.sender, address(this), totalCost), "Spawn Payment Failed");
        
        treasuryBalance += (totalCost * TREASURY_BPS) / 10000;
        
        _mint(msg.sender, tokenId, units, "");
        agentStacks[msg.sender][tokenId].birthBlock = block.number;

        _registerOccupant(tokenId, msg.sender);
        emit Spawned(msg.sender, tokenId, units);
    }

    function move(uint16 fromCube, uint16 toCube, uint256 units, bool boosted) external {
        require(_isAdjacent(fromCube, toCube), "Movement restricted to adjacent cubes");
        uint256 fId = boosted ? uint256(fromCube) + 216 : uint256(fromCube);
        uint256 tId = boosted ? uint256(toCube) + 216 : uint256(toCube);

        _safeTransferFrom(msg.sender, msg.sender, fId, units, "");
        
        // Age resets on move to prevent "teleporting" old bounties
        agentStacks[msg.sender][tId].birthBlock = block.number;

        _registerOccupant(tId, msg.sender);
        emit Moved(msg.sender, fId, tId, units);
    }

    // --- Internal Helpers ---

    function _registerOccupant(uint256 tokenId, address agent) internal {
        if (!isOccupying[tokenId][agent]) {
            cubeOccupants[tokenId].push(agent);
            isOccupying[tokenId][agent] = true;
        }
    }

    /**
     * @dev Checks if two cubes are adjacent in a 6x6x6 grid using XYZ coordinates.
     */
    function _isAdjacent(uint16 c1, uint16 c2) internal pure returns (bool) {
        if (c1 == c2 || c1 == 0 || c2 == 0) return false;
        
        // Convert 1-based index to 0-based XYZ
        uint16 v1 = c1 - 1;
        uint16 v2 = c2 - 1;

        int16 x1 = int16(v1 % 6);
        int16 y1 = int16((v1 / 6) % 6);
        int16 z1 = int16(v1 / 36);

        int16 x2 = int16(v2 % 6);
        int16 y2 = int16((v2 / 6) % 6);
        int16 z2 = int16(v2 / 36);

        // Calculate Manhattan distance
        uint16 dist = uint16(
            (x1 > x2 ? x1 - x2 : x2 - x1) +
            (y1 > y2 ? y1 - y2 : y2 - y1) +
            (z1 > z2 ? z1 - z2 : z2 - z1)
        );

        return dist == 1;
    }

    // --- View Functions ---

    function getRipeStacks(uint16 cube, bool boosted) external view returns (address[] memory agents, uint256[] memory ages) {
        uint256 tokenId = boosted ? uint256(cube) + 216 : uint256(cube);
        address[] memory occupants = cubeOccupants[tokenId];
        
        agents = new address[](occupants.length);
        ages = new uint256[](occupants.length);

        for (uint256 i = 0; i < occupants.length; i++) {
            address occupant = occupants[i];
            if (balanceOf(occupant, tokenId) > 0) {
                agents[i] = occupant;
                ages[i] = block.number - agentStacks[occupant][tokenId].birthBlock;
            }
        }
    }

    function getPendingBounty(address agent, uint256 tokenId) public view returns (uint256) {
        uint256 age = block.number - agentStacks[agent][tokenId].birthBlock;
        return (treasuryBalance * age) / 1000000; 
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
