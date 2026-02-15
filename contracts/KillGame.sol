// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title KILLGame
 * @dev A high-stakes strategy game involving standard units and Reaper bonuses.
 * Features bi-directional looting, adjacency-based movement, and scalable rewards.
 */
contract KILLGame is ERC1155, ReentrancyGuard, Ownable {
    // --- EVENTS ---
    // Added 'reapers' field to Spawned event to ensure Subgraph/API visibility
    event Spawned(address indexed agent, uint256 indexed stackId, uint256 units, uint256 reapers, uint256 birthBlock);
    
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
    
    event DefenderRewarded(address indexed defender, uint256 amount);
    
    event TreasuryBpsUpdated(uint256 oldBps, uint256 newBps);

    // --- ECONOMIC CONSTANTS & VARIABLES ---
    uint256 public constant BURN_BPS = 666; 
    uint256 public constant SPAWN_COST = 10 * 10**18;
    uint256 public constant REAPER_SPAWN_COST = 6660 * 10**18; // 666 * SPAWN_COST
    uint256 public constant MOVE_COST = 10 * 10**18;
    
    // Adjustable treasury emission rate
    uint256 public treasuryBps = 2500; // 25% initial
    
    uint256 public constant BURN_OF_TREASURY_BPS = 666; // 6.66% of the 25%
    uint256 public constant SENDER_BPS = 7500; // 75%
    
    IERC20 public immutable killToken;
    uint256 public treasuryBalance;
    uint256 public totalUnitsMinted;
    
    uint256 public totalUnitsKilled;
    uint256 public totalReaperKilled;
    uint256 public totalKillExtracted;
    uint256 public totalKillBurned;

    // --- STORAGE ---
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
    mapping(address => uint256) public agentTotalProfit;

    constructor(address _tokenAddress) ERC1155("https://api.killgame.ai/metadata/{id}.json") Ownable(msg.sender) {
        killToken = IERC20(_tokenAddress);
    }

    // --- ADMIN FUNCTIONS ---

    /**
     * @dev Adjust the emission rate. Higher BPS = Higher rewards for players.
     */
    function setTreasuryBps(uint256 _newBps) external onlyOwner {
        require(_newBps <= 10000, "Max 100%");
        uint256 oldBps = treasuryBps;
        treasuryBps = _newBps;
        emit TreasuryBpsUpdated(oldBps, _newBps);
    }

    /**
     * @dev Manual treasury withdrawal for owner/emergency use.
     */
    function adminWithdraw(uint256 amt) external onlyOwner { 
        killToken.transfer(msg.sender, amt); 
    }

    // --- VIEWS ---

    function getBirthBlock(address agent, uint256 id) public view returns (uint256) {
        return agentStacks[agent][id].birthBlock;
    }

    /**
     * @dev Returns full details of all occupants in a specific cube (stack).
     */
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

    /**
     * @dev Calculates bounty based on treasury balance, time elapsed, and treasuryBps.
     */
    function getPendingBounty(address agent, uint256 id) public view returns (uint256) {
        if(agentStacks[agent][id].birthBlock == 0) return 0;
        return (treasuryBalance * (block.number - agentStacks[agent][id].birthBlock) * treasuryBps) / (10000 * 1000000); 
    }

    // --- CORE GAME LOGIC ---

    /**
    * @dev KILL function v2.1 - Bi-directional Looting (Stack-Safe)
    * Solves combat between two agents and transfers bounties based on units lost.
    */
    function kill(address target, uint16 stackId, uint256 sentUnits, uint256 sentReaper) 
        external 
        nonReentrant 
        returns (uint256 attackerBounty) 
    {
        uint256 unitId = uint256(stackId);
        uint256 reaperId = unitId + 216;
        
        require(balanceOf(msg.sender, unitId) >= sentUnits && 
                balanceOf(msg.sender, reaperId) >= sentReaper, "Lack units");

        uint256 targetBirth = agentStacks[target][unitId].birthBlock; 
        
        // Internal combat resolution
        LossReport memory loss = _resolveCombat(msg.sender, target, unitId, reaperId, sentUnits, sentReaper);

        // Occupancy cleanup
        if (loss.tUnits == balanceOf(target, unitId)) isOccupying[unitId][target] = false;
        if (loss.tReaper == balanceOf(target, reaperId)) isOccupying[reaperId][target] = false;

        // 1. Attacker gets bounty for defender units killed
        if (loss.tUnits > 0 || loss.tReaper > 0) {
            attackerBounty = _calculateLoot(target, unitId, loss.tUnits, loss.tReaper);
            _transferBounty(msg.sender, attackerBounty);
            agentTotalProfit[msg.sender] += attackerBounty;
        }

        // 2. Defender gets bounty for attacker units killed
        uint256 defenderBounty = 0;
        if (loss.aUnits > 0 || loss.aReaper > 0) {
            defenderBounty = (loss.aUnits * SPAWN_COST) + (loss.aReaper * REAPER_SPAWN_COST);
            defenderBounty = (defenderBounty * 75) / 100;
            _transferBounty(target, defenderBounty);
            agentTotalProfit[target] += defenderBounty;
        }

        _updateGlobalStats(loss);

        // Final Burns
        if (loss.tUnits > 0) _burn(target, unitId, loss.tUnits);
        if (loss.tReaper > 0) _burn(target, reaperId, loss.tReaper);
        if (loss.aUnits > 0) _burn(msg.sender, unitId, loss.aUnits);
        if (loss.aReaper > 0) _burn(msg.sender, reaperId, loss.aReaper);

        emit Killed(msg.sender, target, stackId, loss.aUnits, loss.aReaper, loss.tUnits, loss.tReaper, attackerBounty, targetBirth);
        emit DefenderRewarded(target, defenderBounty);
        emit GlobalStats(totalUnitsKilled, totalReaperKilled, totalUnitsMinted * SPAWN_COST, totalKillExtracted, totalKillBurned);
        
        return attackerBounty;
    }

    /**
     * @dev Spawn standard units with Reaper bonus logic.
     * Guaranteed 500 Reapers for 333,333 standard units.
     */
    function spawn(uint16 stackId, uint256 amount) external nonReentrant {
        require(stackId > 0 && stackId <= 216, "Invalid Stack");
        uint256 totalCost = amount * SPAWN_COST;
        
        require(killToken.transferFrom(msg.sender, address(this), totalCost), "Pay fail");
        
        unchecked {
            uint256 burnAmt = (totalCost * BURN_BPS) / 10000;
            uint256 treasuryAmt = totalCost - burnAmt;
            
            treasuryBalance += treasuryAmt;
            totalKillBurned += burnAmt; 
            totalUnitsMinted += amount;
        }
        
        // Direct calculation: 333,333 / 666 = 500
        uint256 reaperCount = amount / 666;

        _mintAndReg(msg.sender, uint256(stackId), amount);
        
        if (reaperCount > 0) {
            _mintAndReg(msg.sender, uint256(stackId) + 216, reaperCount);
        }
        
        // Updated event emission with reaperCount for API indexing
        emit Spawned(msg.sender, stackId, amount, reaperCount, block.number);
        emit GlobalStats(totalUnitsKilled, totalReaperKilled, totalUnitsMinted * SPAWN_COST, totalKillExtracted, totalKillBurned);
    }

    /**
     * @dev Move function with BirthBlock reset logic.
     */
    function move(uint16 fromStack, uint16 toStack, uint256 units, uint256 reaper) external nonReentrant {
        require(fromStack > 0 && fromStack <= 216, "Invalid From");
        require(toStack > 0 && toStack <= 216 && _isAdjacent(fromStack, toStack), "Bad move");
        
        require(killToken.transferFrom(msg.sender, address(this), MOVE_COST), "Pay fail");

        unchecked {
            uint256 burnAmt = (MOVE_COST * BURN_BPS) / 10000;
            uint256 treasuryAmt = MOVE_COST - burnAmt;

            treasuryBalance += treasuryAmt;
            totalKillBurned += burnAmt;
        }

        if (units > 0) _moveLogic(uint256(fromStack), uint256(toStack), units);
        if (reaper > 0) _moveLogic(uint256(fromStack) + 216, uint256(toStack) + 216, reaper);
        
        emit Moved(msg.sender, fromStack, toStack, units, reaper, block.number);
        emit GlobalStats(totalUnitsKilled, totalReaperKilled, totalUnitsMinted * SPAWN_COST, totalKillExtracted, totalKillBurned);
    }

    // --- INTERNAL HELPERS ---

    /**
    * @dev Internal combat resolution math.
    */
    function _resolveCombat(
        address attacker, 
        address target, 
        uint256 uId, 
        uint256 rId, 
        uint256 sU, 
        uint256 sR
    ) internal view returns (LossReport memory loss) {
        uint256 atkP = sU + (sR * 666);
        uint256 defU = balanceOf(target, uId);
        uint256 defR = balanceOf(target, rId);
        
        if (attacker == target) { defU -= sU; defR -= sR; }

        uint256 defP = (defU + (defR * 666)) * 110 / 100;
        if (defP == 0) defP = 1;

        if (atkP > defP) {
            loss.tUnits = defU;
            loss.tReaper = defR;
            loss.aUnits = 0;
            loss.aReaper = 0;
        } else {
            loss.aUnits = sU;
            loss.aReaper = sR;
            uint256 pSq = atkP * atkP;
            uint256 dSq = defP * defP;
            loss.tUnits = (defU * pSq) / dSq;
            loss.tReaper = (defR * pSq) / dSq;
        }
        return loss;
    }

    function _calculateLoot(address target, uint256 uId, uint256 tU, uint256 tR) internal view returns (uint256) {
        uint256 totalPending = getPendingBounty(target, uId) + getPendingBounty(target, uId + 216);
        uint256 totalAtStake = balanceOf(target, uId) + (balanceOf(target, uId + 216) * 666);
        if (totalAtStake == 0) return 0;
        
        uint256 damagePower = tU + (tR * 666);
        uint256 loot = (totalPending * damagePower) / totalAtStake;
        return (loot * SENDER_BPS) / 10000;
    }

    function _transferBounty(address recipient, uint256 amount) internal {
        if (amount > 0) {
            require(treasuryBalance >= amount, "Treasury underflow");
            treasuryBalance -= amount;
            totalKillExtracted += amount;
            require(killToken.transfer(recipient, amount), "Payout fail");
        }
    }

    function _updateGlobalStats(LossReport memory loss) internal {
        unchecked {
            totalUnitsKilled += (loss.aUnits + loss.tUnits);
            totalReaperKilled += (loss.aReaper + loss.tReaper);
        }
    }

    function _mintAndReg(address to, uint256 id, uint256 amt) internal {
        _mint(to, id, amt, "");
        agentStacks[to][id].birthBlock = block.number;
        if (!isOccupying[id][to]) { 
            stackOccupants[id].push(to); 
            isOccupying[id][to] = true; 
        }
    }

    function _moveLogic(uint256 fId, uint256 tId, uint256 amt) internal {
        require(balanceOf(msg.sender, fId) >= amt, "Insufficient units");
        _burn(msg.sender, fId, amt);
        
        if (balanceOf(msg.sender, fId) == 0) {
            isOccupying[fId][msg.sender] = false;
            delete agentStacks[msg.sender][fId];
        }

        _mint(msg.sender, tId, amt, "");
        if (agentStacks[msg.sender][tId].birthBlock == 0) {
            agentStacks[msg.sender][tId].birthBlock = block.number;
        }

        if (!isOccupying[tId][msg.sender]) {
            stackOccupants[tId].push(msg.sender);
            isOccupying[tId][msg.sender] = true;
        }
    }

    /**
     * @dev Adjacency math for a 6x6x6 cube grid.
     */
    function _isAdjacent(uint16 c1, uint16 c2) internal pure returns (bool) {
        uint16 v1 = c1 - 1; uint16 v2 = c2 - 1;
        int16 x1 = int16(v1 % 6); int16 y1 = int16((v1 / 6) % 6); int16 z1 = int16(v1 / 36);
        int16 x2 = int16(v2 % 6); int16 y2 = int16((v2 / 6) % 6); int16 z2 = int16(v2 / 36);
        return uint16((x1>x2?x1-x2:x2-x1)+(y1>y2?y1-y2:y2-y1)+(z1>z2?z1-z2:z2-z1)) == 1;
    }

    function supportsInterface(bytes4 id) public view virtual override(ERC1155) returns (bool) { 
        return super.supportsInterface(id); 
    }
}