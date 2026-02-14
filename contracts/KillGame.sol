// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KILLGame is ERC1155, ReentrancyGuard, Ownable {
    event Spawned(address indexed agent, uint256 indexed stackId, uint256 units, uint256 birthBlock);
    event Moved(address indexed agent, uint16 fromStack, uint16 toStack, uint256 units, uint256 reaper, uint256 birthBlock);
    event Killed(
        address indexed attacker, 
        address indexed target, 
        uint16 indexed stackId, 
        uint256 attackerUnitsLost, 
        uint256 attackerReaperLost, 
        uint256 targetUnitsLost, 
        uint256 targetReaperLost, 
        uint256 netBounty,
        uint256 targetBirthBlock
    );
    
    event GlobalStats(uint256 totalUnitsKilled, uint256 totalReaperKilled, uint256 killAdded, uint256 killExtracted, uint256 killBurned);

    // --- ECONOMIC CONSTANTS ---
    uint256 public constant BURN_BPS = 666; 
    uint256 public constant SPAWN_COST = 10 * 10**18;
    uint256 public constant MOVE_COST = 10 * 10**18;
    uint256 public constant TREASURY_BPS = 2500; // 25%
    uint256 public constant BURN_OF_TREASURY_BPS = 666; // 6.66% of the 25%
    uint256 public constant SENDER_BPS = 7500; // 75%
    
    IERC20 public immutable killToken;
    uint256 public treasuryBalance;
    uint256 public totalUnitsMinted;
    
    uint256 public totalUnitsKilled;
    uint256 public totalReaperKilled;
    uint256 public totalKillExtracted;
    uint256 public totalKillBurned;

    struct ReaperStack { uint256 birthBlock; }
    struct LossReport { uint256 aUnits; uint256 aReaper; uint256 tUnits; uint256 tReaper; }

    struct StackInfo {
        address occupant;
        uint256 units;
        uint256 reapers;
        uint256 age;
        uint256 pendingBounty;
    }

    mapping(address => mapping(uint256 => ReaperStack)) public agentStacks;
    mapping(uint256 => address[]) private stackOccupants;
    mapping(uint256 => mapping(address => bool)) private isOccupying;

    constructor(address _tokenAddress) ERC1155("https://api.killgame.ai/metadata/{id}.json") Ownable(msg.sender) {
        killToken = IERC20(_tokenAddress);
    }

    // --- VIEWS ---

    function getBirthBlock(address agent, uint256 id) public view returns (uint256) {
        return agentStacks[agent][id].birthBlock;
    }

    function getFullStack(uint16 stackId) external view returns (StackInfo[] memory) {
        uint256 unitId = uint256(stackId);
        uint256 reaperId = unitId + 216;
        address[] memory occ = stackOccupants[unitId];
        
        uint256 count = 0;
        for (uint256 i = 0; i < occ.length; i++) {
            if (isOccupying[unitId][occ[i]] || isOccupying[reaperId][occ[i]]) count++;
        }

        StackInfo[] memory info = new StackInfo[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < occ.length; i++) {
            address target = occ[i];
            if (isOccupying[unitId][target] || isOccupying[reaperId][target]) {
                uint256 u = balanceOf(target, unitId);
                uint256 r = balanceOf(target, reaperId);
                uint256 birth = agentStacks[target][unitId].birthBlock;
                
                info[idx] = StackInfo({
                    occupant: target,
                    units: u,
                    reapers: r,
                    age: birth > 0 ? block.number - birth : 0,
                    pendingBounty: getPendingBounty(target, unitId) + getPendingBounty(target, reaperId)
                });
                idx++;
            }
        }
        return info;
    }

    function getPendingBounty(address agent, uint256 id) public view returns (uint256) {
        if(agentStacks[agent][id].birthBlock == 0) return 0;
        return (treasuryBalance * (block.number - agentStacks[agent][id].birthBlock)) / 1000000; 
    }

    // --- CORE GAME LOGIC ---

    function kill(address target, uint16 stackId, uint256 sentUnits, uint256 sentReaper) 
        external 
        nonReentrant 
        returns (uint256 netBounty) 
    {
        uint256 unitId = uint256(stackId);
        uint256 reaperId = unitId + 216;
        
        require(balanceOf(msg.sender, unitId) >= sentUnits && 
                balanceOf(msg.sender, reaperId) >= sentReaper, "Lack units");

        LossReport memory loss;
        uint256 targetBirth = agentStacks[target][unitId].birthBlock; 
        
        // Scoped block for power calculations to free stack space immediately after
        uint256 atkPower = sentUnits + (sentReaper * 666);
        uint256 defPower;
        {
            uint256 effDefUnits = balanceOf(target, unitId);
            uint256 effDefReaper = balanceOf(target, reaperId);
            if (msg.sender == target) { 
                effDefUnits -= sentUnits; 
                effDefReaper -= sentReaper; 
            }
            defPower = (effDefUnits + (effDefReaper * 666)) * 110 / 100;
            if (defPower == 0) defPower = 1;
            loss.tUnits = effDefUnits; 
            loss.tReaper = effDefReaper;
        }

        if (atkPower > defPower) {
            // Calculate and transfer bounty via helper to avoid Stack Too Deep
            netBounty = _processBounty(target, unitId, reaperId);
            
            isOccupying[unitId][target] = false;
            isOccupying[reaperId][target] = false;
        } else {
            loss.aUnits = sentUnits;
            loss.aReaper = sentReaper;
            
            // Complex math here also consumes stack; keeping it in the else block helps
            uint256 pwrSq = atkPower * atkPower;
            uint256 defSq = defPower * defPower;
            
            loss.tUnits = (loss.tUnits * pwrSq) / defSq;
            loss.tReaper = (loss.tReaper * pwrSq) / defSq;
            
            if (loss.tUnits == 0) isOccupying[unitId][target] = false;
            if (loss.tReaper == 0) isOccupying[reaperId][target] = false;
        }

        // Global Statistics Tracking
        _updateGlobalStats(loss);

        // Final Burns
        if (loss.tUnits > 0) _burn(target, unitId, loss.tUnits);
        if (loss.tReaper > 0) _burn(target, reaperId, loss.tReaper);
        if (loss.aUnits > 0) _burn(msg.sender, unitId, loss.aUnits);
        if (loss.aReaper > 0) _burn(msg.sender, reaperId, loss.aReaper);

        emit Killed(msg.sender, target, stackId, loss.aUnits, loss.aReaper, loss.tUnits, loss.tReaper, netBounty, targetBirth);
        emit GlobalStats(totalUnitsKilled, totalReaperKilled, totalUnitsMinted * SPAWN_COST, totalKillExtracted, totalKillBurned);
    }

    function spawn(uint16 stackId, uint256 amount) external nonReentrant {
        require(stackId > 0 && stackId <= 216, "Invalid Stack");
        uint256 totalCost = amount * SPAWN_COST;
        
        // 1. Pull full cost to treasury (this contract)
        require(killToken.transferFrom(msg.sender, address(this), totalCost), "Pay fail");
        
        // 2. Burn 6.66% of that incoming value
        uint256 burnAmt = (totalCost * BURN_BPS) / 10000;
        uint256 treasuryAmt = totalCost - burnAmt;
        
        treasuryBalance += treasuryAmt;
        totalKillBurned += burnAmt; 
        
        uint256 oldTotal = totalUnitsMinted;
        totalUnitsMinted += amount;
        
        // milestone logic: Reaper = floor(total/666)
        uint256 reaperCount = (totalUnitsMinted / 666) - (oldTotal / 666);
        uint256 unitsCount = amount - reaperCount;

        if (unitsCount > 0) _mintAndReg(msg.sender, uint256(stackId), unitsCount);
        if (reaperCount > 0) _mintAndReg(msg.sender, uint256(stackId) + 216, reaperCount);
        
        emit Spawned(msg.sender, stackId, amount, block.number);
        emit GlobalStats(totalUnitsKilled, totalReaperKilled, totalUnitsMinted * SPAWN_COST, totalKillExtracted, totalKillBurned);
    }

    function move(uint16 fromStack, uint16 toStack, uint256 units, uint256 reaper) external nonReentrant {
        require(fromStack > 0 && fromStack <= 216, "Invalid From");
        require(toStack > 0 && toStack <= 216 && _isAdjacent(fromStack, toStack), "Bad move");
        
        // 1. Pull move cost to treasury
        require(killToken.transferFrom(msg.sender, address(this), MOVE_COST), "Pay fail");

        // 2. Burn 6.66% of move cost
        uint256 burnAmt = (MOVE_COST * BURN_BPS) / 10000;
        uint256 treasuryAmt = MOVE_COST - burnAmt;

        treasuryBalance += treasuryAmt;
        totalKillBurned += burnAmt;

        if (units > 0) _moveLogic(uint256(fromStack), uint256(toStack), units);
        if (reaper > 0) _moveLogic(uint256(fromStack) + 216, uint256(toStack) + 216, reaper);
        
        emit Moved(msg.sender, fromStack, toStack, units, reaper, block.number);
        emit GlobalStats(totalUnitsKilled, totalReaperKilled, totalUnitsMinted * SPAWN_COST, totalKillExtracted, totalKillBurned);
    }

    // --- INTERNAL HELPERS ---

    /**
    * @dev Isolates bounty math to resolve Stack Too Deep errors.
    */
    function _processBounty(address target, uint256 uId, uint256 rId) internal returns (uint256 netBounty) {
        uint256 totalBounty = getPendingBounty(target, uId) + getPendingBounty(target, rId);
        
        uint256 treasurySlice = (totalBounty * TREASURY_BPS) / 10000;
        uint256 burnAmt = (treasurySlice * BURN_OF_TREASURY_BPS) / 10000;
        netBounty = (totalBounty * SENDER_BPS) / 10000;
        
        // Remaining (treasurySlice - burnAmt) effectively stays in treasury via subtraction
        treasuryBalance -= (netBounty + burnAmt); 
        
        totalKillBurned += burnAmt;
        totalKillExtracted += netBounty;
        
        require(killToken.transfer(msg.sender, netBounty), "Payout fail");
    }

    function _updateGlobalStats(LossReport memory loss) internal {
        totalUnitsKilled += (loss.aUnits + loss.tUnits);
        totalReaperKilled += (loss.aReaper + loss.tReaper);
    }
    function _mintAndReg(address to, uint256 id, uint256 amt) internal {
        _mint(to, id, amt, "");
        agentStacks[to][id].birthBlock = block.number;
        if (!isOccupying[id][to]) { stackOccupants[id].push(to); isOccupying[id][to] = true; }
    }

    function _moveLogic(uint256 fId, uint256 tId, uint256 amt) internal {
        require(balanceOf(msg.sender, fId) >= amt, "Insufficient units");
        _burn(msg.sender, fId, amt);
        _mint(msg.sender, tId, amt, "");
        agentStacks[msg.sender][tId].birthBlock = block.number;
        if (balanceOf(msg.sender, fId) == 0) isOccupying[fId][msg.sender] = false;
        if (!isOccupying[tId][msg.sender]) { stackOccupants[tId].push(msg.sender); isOccupying[tId][msg.sender] = true; }
    }

    function _isAdjacent(uint16 c1, uint16 c2) internal pure returns (bool) {
        uint16 v1 = c1 - 1; uint16 v2 = c2 - 1;
        int16 x1 = int16(v1 % 6); int16 y1 = int16((v1 / 6) % 6); int16 z1 = int16(v1 / 36);
        int16 x2 = int16(v2 % 6); int16 y2 = int16((v2 / 6) % 6); int16 z2 = int16(v2 / 36);
        return uint16((x1>x2?x1-x2:x2-x1)+(y1>y2?y1-y2:y2-y1)+(z1>z2?z1-z2:z2-z1)) == 1;
    }

    function adminWithdraw(uint256 amt) external onlyOwner { killToken.transfer(msg.sender, amt); }

    function supportsInterface(bytes4 id) public view virtual override(ERC1155) returns (bool) { return super.supportsInterface(id); }
}