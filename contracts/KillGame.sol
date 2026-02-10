// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KILLGame is ERC1155, ReentrancyGuard, Ownable {
    // --- Events ---
    event Spawned(address indexed agent, uint256 indexed cube, uint256 units);
    event Moved(address indexed agent, uint16 fromCube, uint16 toCube, uint256 standardUnits, uint256 boostedUnits);
    event Killed(
        address indexed attacker, 
        address indexed target, 
        uint16 indexed cube, 
        uint256 attackerStdLost, 
        uint256 attackerBstLost, 
        uint256 targetStdLost, 
        uint256 targetBstLost, 
        uint256 netBounty
    );

    // --- Constants ---
    uint256 public constant BURN_BPS = 666; 
    uint256 public constant TREASURY_BPS = 9334;
    uint256 public constant SPAWN_COST = 10 * 10**18;
    uint256 public constant BOOST_REQUIRED = 666;

    // --- State ---
    IERC20 public immutable killToken;
    uint256 public treasuryBalance;
    uint256 public totalUnitsMinted;

    struct ReaperStack { uint256 birthBlock; }
    struct LossReport { uint256 aStd; uint256 aBst; uint256 tStd; uint256 tBst; }

    mapping(address => mapping(uint256 => ReaperStack)) public agentStacks;
    mapping(uint256 => address[]) private cubeOccupants;
    mapping(uint256 => mapping(address => bool)) private isOccupying;

    constructor(address _tokenAddress) 
        ERC1155("https://api.killgame.ai/metadata/{id}.json") 
        Ownable(msg.sender) 
    {
        killToken = IERC20(_tokenAddress);
    }

    /**
     * @dev Quadratic Attrition Battle Logic
     * Formula: Winner Loss = Sent * (LoserPower / WinnerPower)^2
     */
    function kill(address target, uint16 cube, uint256 sentStd, uint256 sentBst) external nonReentrant returns (uint256 netBounty) {
        uint256 stdId = uint256(cube);
        uint256 bstId = stdId + 216;

        uint256 atkPower = sentStd + (sentBst * 666);
        require(atkPower > 0, "No force");
        require(balanceOf(msg.sender, stdId) >= sentStd && balanceOf(msg.sender, bstId) >= sentBst, "Lack units");

        uint256 defPower = ((balanceOf(target, stdId) + (balanceOf(target, bstId) * 666)) * 110) / 100;
        require(defPower > 0, "No target");

        LossReport memory loss;

        if (atkPower > defPower) {
            loss.tStd = balanceOf(target, stdId);
            loss.tBst = balanceOf(target, bstId);
            
            // Attrition math: loss is proportional to (Def/Atk)^2
            loss.aStd = (sentStd * (defPower * defPower)) / (atkPower * atkPower);
            loss.aBst = (sentBst * (defPower * defPower)) / (atkPower * atkPower);

            { 
                uint256 totalBounty = getPendingBounty(target, stdId) + getPendingBounty(target, bstId);
                uint256 burnAmt = (totalBounty * BURN_BPS) / 10000;
                netBounty = totalBounty - burnAmt;
                treasuryBalance -= totalBounty;
                require(killToken.transfer(msg.sender, netBounty), "Payout fail");
            }
            isOccupying[stdId][target] = false;
            isOccupying[bstId][target] = false;
        } else {
            loss.aStd = sentStd;
            loss.aBst = sentBst;

            loss.tStd = (balanceOf(target, stdId) * (atkPower * atkPower)) / (defPower * defPower);
            loss.tBst = (balanceOf(target, bstId) * (atkPower * atkPower)) / (defPower * defPower);
            netBounty = 0;
            
            if (balanceOf(target, stdId) == loss.tStd) isOccupying[stdId][target] = false;
            if (balanceOf(target, bstId) == loss.tBst) isOccupying[bstId][target] = false;
        }

        if (loss.tStd > 0) _burn(target, stdId, loss.tStd);
        if (loss.tBst > 0) _burn(target, bstId, loss.tBst);
        if (loss.aStd > 0) _burn(msg.sender, stdId, loss.aStd);
        if (loss.aBst > 0) _burn(msg.sender, bstId, loss.aBst);

        emit Killed(msg.sender, target, cube, loss.aStd, loss.aBst, loss.tStd, loss.tBst, netBounty);
    }

    function spawn(uint16 cube, uint256 units) external nonReentrant {
        require(cube > 0 && cube <= 216, "Invalid Cube");
        require(killToken.transferFrom(msg.sender, address(this), units * SPAWN_COST), "Pay fail");
        
        treasuryBalance += (units * SPAWN_COST * TREASURY_BPS) / 10000;
        uint256 oldTotal = totalUnitsMinted;
        totalUnitsMinted += units;
        
        uint256 bstCount = (totalUnitsMinted / 666) - (oldTotal / 666);
        uint256 stdCount = units - bstCount;

        if (stdCount > 0) _mintAndReg(msg.sender, uint256(cube), stdCount);
        if (bstCount > 0) _mintAndReg(msg.sender, uint256(cube) + 216, bstCount);
        emit Spawned(msg.sender, cube, units);
    }

    function move(uint16 fromCube, uint16 toCube, uint256 stdUnits, uint256 bstUnits) external {
        // FIX: Ensure IDs are valid and adjacent
        require(fromCube > 0 && fromCube <= 216, "Invalid From");
        require(toCube > 0 && toCube <= 216 && _isAdjacent(fromCube, toCube), "Bad move");
        
        if (stdUnits > 0) _moveLogic(uint256(fromCube), uint256(toCube), stdUnits);
        if (bstUnits > 0) _moveLogic(uint256(fromCube) + 216, uint256(toCube) + 216, bstUnits);
        
        emit Moved(msg.sender, fromCube, toCube, stdUnits, bstUnits);
    }

    function _mintAndReg(address to, uint256 id, uint256 amt) internal {
        _mint(to, id, amt, "");
        agentStacks[to][id].birthBlock = block.number;
        if (!isOccupying[id][to]) {
            cubeOccupants[id].push(to);
            isOccupying[id][to] = true;
        }
    }

    /**
     * @dev Logic fix: We use _burn and _mint (internal) to bypass the ERC1155 
     * onERC1155Received check since we are just moving units within the owner's 
     * account across different cube IDs.
     */
    function _moveLogic(uint256 fId, uint256 tId, uint256 amt) internal {
        require(balanceOf(msg.sender, fId) >= amt, "Insufficient units");
        
        // Use internal _burn and _mint to move "locally" without safe checks
        _burn(msg.sender, fId, amt);
        _mint(msg.sender, tId, amt, "");

        agentStacks[msg.sender][tId].birthBlock = block.number;
        
        if (balanceOf(msg.sender, fId) == 0) isOccupying[fId][msg.sender] = false;
        if (!isOccupying[tId][msg.sender]) {
            cubeOccupants[tId].push(msg.sender);
            isOccupying[tId][msg.sender] = true;
        }
    }

    function _isAdjacent(uint16 c1, uint16 c2) internal pure returns (bool) {
        if (c1 == c2 || c1 == 0 || c2 == 0) return false;
        uint16 v1 = c1 - 1; uint16 v2 = c2 - 1;
        int16 x1 = int16(v1 % 6); int16 y1 = int16((v1 / 6) % 6); int16 z1 = int16(v1 / 36);
        int16 x2 = int16(v2 % 6); int16 y2 = int16((v2 / 6) % 6); int16 z2 = int16(v2 / 36);
        uint16 d = uint16((x1>x2?x1-x2:x2-x1)+(y1>y2?y1-y2:y2-y1)+(z1>z2?z1-z2:z2-z1));
        return d == 1;
    }

    function getPendingBounty(address agent, uint256 id) public view returns (uint256) {
        if(agentStacks[agent][id].birthBlock == 0) return 0;
        return (treasuryBalance * (block.number - agentStacks[agent][id].birthBlock)) / 1000000; 
    }

    function adminWithdraw(uint256 amt) external onlyOwner {
        killToken.transfer(msg.sender, amt);
    }

    function getRipeStacks(uint16 cube, bool b) external view returns (address[] memory a, uint256[] memory ag) {
        uint256 id = b ? uint256(cube) + 216 : uint256(cube);
        address[] memory occ = cubeOccupants[id];
        uint256 count = 0;
        for (uint256 i = 0; i < occ.length; i++) if (isOccupying[id][occ[i]] && balanceOf(occ[i], id) > 0) count++;
        a = new address[](count); ag = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < occ.length; i++) {
            if (isOccupying[id][occ[i]] && balanceOf(occ[i], id) > 0) {
                a[j] = occ[i];
                ag[j] = block.number - agentStacks[occ[i]][id].birthBlock;
                j++;
            }
        }
    }

    function supportsInterface(bytes4 id) public view virtual override(ERC1155) returns (bool) {
        return super.supportsInterface(id);
    }
}