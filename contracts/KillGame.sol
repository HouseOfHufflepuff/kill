// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";

/**
 * @title KILLGame
 * @dev High-Velocity Economic Model:
 * 1. Base Stack Power: units + (reaper * 666).
 * 2. Multiplier: 0x to 20x over 3 days (21,600 blocks).
 * 3. Treasury Cap: Max payout is 25% of current treasury balance.
 * 4. Thermal Parity: 666 total power loss required for 100% bounty extraction.
 */
contract KILLGame is ERC1155, ReentrancyGuard, Ownable, Multicall {
    // --- STRUCTS ---
    struct ReaperStack { 
        uint256 birthBlock; 
    }

    struct LossReport { 
        uint256 aUnits; 
        uint256 aReaper; 
        uint256 tUnits; 
        uint256 tReaper; 
    }
    
    struct BattleSummary {
        uint256 attackerUnitsSent;
        uint256 attackerReaperSent;
        uint256 attackerUnitsLost;
        uint256 attackerReaperLost;
        uint256 targetUnitsLost;
        uint256 targetReaperLost;
        uint256 initialDefenderUnits;
        uint256 initialDefenderReaper;
        uint256 attackerBounty;
        uint256 defenderBounty;
    }

    struct StackInfo {
        address occupant;
        uint256 units;
        uint256 reapers;
        uint256 age;
        uint256 pendingBounty;
    }

    // --- EVENTS ---
    event Spawned(address indexed agent, uint256 indexed stackId, uint256 units, uint256 reapers, uint256 birthBlock);
    event Moved(address indexed agent, uint16 fromStack, uint16 toStack, uint256 units, uint256 reaper, uint256 birthBlock);
    event Killed(address indexed attacker, address indexed target, uint16 indexed stackId, BattleSummary summary, uint256 targetBirthBlock);
    event GlobalStats(uint256 totalUnitsKilled, uint256 totalReaperKilled, uint256 killAdded, uint256 killExtracted, uint256 killBurned);
    event DefenderRewarded(address indexed defender, uint256 amount);
    event TreasuryBpsUpdated(uint256 oldBps, uint256 newBps);

    // --- ECONOMIC CONSTANTS ---
    uint256 public constant BURN_BPS = 666; 
    uint256 public constant SPAWN_COST_PER_POWER = 10 * 10**18;
    uint256 public constant MOVE_COST = 10 * 10**18;
    uint256 public constant THERMAL_PARITY = 666;
    uint256 public constant MAX_MULTIPLIER = 20;
    uint256 public constant BLOCKS_PER_MULTIPLIER = 1080; // 21,600 blocks / 20x = 1080
    uint256 public constant GLOBAL_CAP_BPS = 2500; // 25%
    
    uint256 public treasuryBps = 0; // Adjustable by owner
    IERC20 public immutable killToken;
    
    // --- GLOBAL TRACKERS ---
    uint256 public totalUnitsKilled;
    uint256 public totalReaperKilled;
    uint256 public totalKillAdded;      
    uint256 public totalKillExtracted;  
    uint256 public totalKillBurned;     

    // --- STORAGE ---
    mapping(address => mapping(uint256 => ReaperStack)) public agentStacks;
    mapping(uint256 => address[]) private stackOccupants;
    mapping(uint256 => mapping(address => bool)) private isOccupying;
    mapping(address => uint256) public agentTotalProfit;

    constructor(address _tokenAddress) ERC1155("https://api.killgame.ai/metadata/{id}.json") Ownable(msg.sender) {
        killToken = IERC20(_tokenAddress);
    }

    // --- ADMIN ---
    function setTreasuryBps(uint256 _newBps) external onlyOwner {
        require(_newBps <= 10000, "Max 100%");
        uint256 old = treasuryBps;
        treasuryBps = _newBps;
        emit TreasuryBpsUpdated(old, _newBps);
    }

    function adminWithdraw(uint256 amt) external onlyOwner { 
        killToken.transfer(msg.sender, amt); 
    }

    // --- VIEWS / HELPERS ---
    function getBirthBlock(address agent, uint256 id) public view returns (uint256) {
        return agentStacks[agent][id].birthBlock;
    }

    /**
     * @dev Calculates bounty using: min(SpawnCost * Multiplier, 25% Treasury)
     */
    function getPendingBounty(address agent, uint256 id) public view returns (uint256) {
        uint256 birth = agentStacks[agent][id].birthBlock;
        if(birth == 0 || block.number <= birth) return 0;

        uint256 uId = (id > 216) ? id - 216 : id;
        uint256 rId = uId + 216;
        
        // Use current balance as treasury reference
        uint256 actualTreasury = killToken.balanceOf(address(this));
        
        // 1. Calculate Multiplier (Age / 1080) capped at 20
        uint256 ageBlocks = block.number - birth;
        uint256 multiplier = ageBlocks / BLOCKS_PER_MULTIPLIER;
        if (multiplier > MAX_MULTIPLIER) multiplier = MAX_MULTIPLIER;

        // 2. Calculate Raw Bounty (Spawn Value * Multiplier)
        uint256 power = balanceOf(agent, uId) + (balanceOf(agent, rId) * 666);
        uint256 spawnValue = power * SPAWN_COST_PER_POWER;
        uint256 rawBounty = spawnValue * multiplier;

        // 3. Apply 25% Global Cap
        uint256 globalCap = (actualTreasury * GLOBAL_CAP_BPS) / 10000;

        return rawBounty > globalCap ? globalCap : rawBounty;
    }

    // --- CORE GAME LOGIC ---
    function kill(address target, uint16 stackId, uint256 sentUnits, uint256 sentReaper) 
        external 
        nonReentrant 
        returns (uint256 attackerBounty) 
    {
        uint256 uId = uint256(stackId);
        uint256 rId = uId + 216;
        require(balanceOf(msg.sender, uId) >= sentUnits && balanceOf(msg.sender, rId) >= sentReaper, "Lack units");
        require(msg.sender != target, "Cannot kill self");

        BattleSummary memory sum;
        sum.attackerUnitsSent = sentUnits;
        sum.attackerReaperSent = sentReaper;
        sum.initialDefenderUnits = balanceOf(target, uId);
        sum.initialDefenderReaper = balanceOf(target, rId);
        uint256 targetBirth = agentStacks[target][uId].birthBlock; 

        LossReport memory loss = _resolveCombat(target, uId, rId, sentUnits, sentReaper);
        
        sum.attackerUnitsLost = loss.aUnits;
        sum.attackerReaperLost = loss.aReaper;
        sum.targetUnitsLost = loss.tUnits;
        sum.targetReaperLost = loss.tReaper;

        attackerBounty = _applyRewards(target, uId, loss, sum);
        
        _updateCombatGlobalStats(loss);
        _executeCombatEffects(msg.sender, target, uId, rId, loss);

        emit Killed(msg.sender, target, stackId, sum, targetBirth);
        _emitGlobalStats(); 
        return attackerBounty;
    }

    function _applyRewards(address target, uint256 uId, LossReport memory loss, BattleSummary memory sum) internal returns (uint256 aB) {
        uint256 tPLost = loss.tUnits + (loss.tReaper * 666);
        uint256 aPLost = loss.aUnits + (loss.aReaper * 666);
        uint256 totalPLost = tPLost + aPLost;
        
        if (totalPLost == 0) return 0;

        uint256 pending = getPendingBounty(target, uId);
        
        // Thermal Parity: Check if enough destruction happened to earn full reward
        uint256 battlePool = totalPLost >= THERMAL_PARITY ? pending : (pending * totalPLost) / THERMAL_PARITY;
        
        // 75% of the battle pool goes to participants (Attacker/Defender)
        uint256 participantPool = (battlePool * 7500) / 10000; 

        if (participantPool > 0) {
            // Split based on loss contribution
            aB = (participantPool * tPLost) / totalPLost;
            _transferBounty(msg.sender, aB);
            agentTotalProfit[msg.sender] += aB;

            uint256 dB = (participantPool * aPLost) / totalPLost;
            _transferBounty(target, dB);
            agentTotalProfit[target] += dB;
            
            sum.attackerBounty = aB;
            sum.defenderBounty = dB;
            emit DefenderRewarded(target, dB);
        }
    }

    function spawn(uint16 stackId, uint256 amount) external nonReentrant {
        require(stackId > 0 && stackId <= 216, "Invalid Stack");
        uint256 reaperCount = amount / 666;
        
        // Spawn cost is based on total power provided
        uint256 totalPower = amount + (reaperCount * 666);
        uint256 totalCost = totalPower * SPAWN_COST_PER_POWER;
        
        require(killToken.transferFrom(msg.sender, address(this), totalCost), "Pay fail");
        
        unchecked {
            totalKillAdded += totalCost;
        }
        
        _mintAndReg(msg.sender, uint256(stackId), amount);
        if (reaperCount > 0) _mintAndReg(msg.sender, uint256(stackId) + 216, reaperCount);
        
        emit Spawned(msg.sender, stackId, amount, reaperCount, block.number);
        _emitGlobalStats(); 
    }

    function move(uint16 fromStack, uint16 toStack, uint256 units, uint256 reaper) external nonReentrant {
        require(fromStack > 0 && fromStack <= 216 && toStack > 0 && toStack <= 216 && _isAdjacent(fromStack, toStack), "Bad move");
        require(killToken.transferFrom(msg.sender, address(this), MOVE_COST), "Pay fail");
        
        unchecked {
            totalKillAdded += MOVE_COST;
        }
        
        if (units > 0) _moveLogic(uint256(fromStack), uint256(toStack), units);
        if (reaper > 0) _moveLogic(uint256(fromStack) + 216, uint256(toStack) + 216, reaper);
        
        emit Moved(msg.sender, fromStack, toStack, units, reaper, block.number);
        _emitGlobalStats(); 
    }

    function _resolveCombat(address target, uint256 uId, uint256 rId, uint256 sU, uint256 sR) internal view returns (LossReport memory loss) {
        uint256 atkP = sU + (sR * 666);
        uint256 defU = balanceOf(target, uId);
        uint256 defR = balanceOf(target, rId);
        uint256 defP = (defU + (defR * 666)) * 110 / 100; // 10% defender advantage
        if (defP == 0) defP = 1;
        
        if (atkP > defP) {
            loss.tUnits = defU;
            loss.tReaper = defR;
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

    function _executeCombatEffects(address atk, address tar, uint256 uId, uint256 rId, LossReport memory loss) internal {
        if (loss.tUnits > 0) _burn(tar, uId, loss.tUnits);
        if (loss.tReaper > 0) _burn(tar, rId, loss.tReaper);
        if (loss.aUnits > 0) _burn(atk, uId, loss.aUnits);
        if (loss.aReaper > 0) _burn(atk, rId, loss.aReaper);

        if (balanceOf(tar, uId) == 0 && balanceOf(tar, rId) == 0) {
            isOccupying[uId][tar] = false;
            delete agentStacks[tar][uId];
        }
        if (balanceOf(atk, uId) == 0 && balanceOf(atk, rId) == 0) {
            isOccupying[uId][atk] = false;
            delete agentStacks[atk][uId];
        }
    }

    function _transferBounty(address recipient, uint256 amount) internal {
        if (amount > 0) {
            uint256 tAmt = (amount * treasuryBps) / 10000;
            uint256 bAmt = (amount * BURN_BPS) / 10000;
            uint256 payout = amount - tAmt - bAmt;

            totalKillExtracted += payout;
            totalKillBurned += bAmt;
            
            require(killToken.transfer(recipient, payout), "Payout fail");
        }
    }

    function _updateCombatGlobalStats(LossReport memory loss) internal {
        unchecked {
            totalUnitsKilled += (loss.aUnits + loss.tUnits);
            totalReaperKilled += (loss.aReaper + loss.tReaper);
        }
    }

    function _emitGlobalStats() internal {
        emit GlobalStats(
            totalUnitsKilled,
            totalReaperKilled,
            totalKillAdded,
            totalKillExtracted,
            totalKillBurned
        );
    }

    function _mintAndReg(address to, uint256 id, uint256 amt) internal {
        _mint(to, id, amt, "");
        if (agentStacks[to][id].birthBlock == 0) agentStacks[to][id].birthBlock = block.number;
        if (!isOccupying[id][to]) { 
            stackOccupants[id].push(to); 
            isOccupying[id][to] = true; 
        }
    }

    function _moveLogic(uint256 fId, uint256 tId, uint256 amt) internal {
        uint256 baseF = (fId > 216) ? fId - 216 : fId;
        uint256 baseT = (tId > 216) ? tId - 216 : tId;

        _burn(msg.sender, fId, amt);
        _mint(msg.sender, tId, amt, "");

        // Resets birthBlock (Age) for both involved stacks
        agentStacks[msg.sender][baseF].birthBlock = block.number;
        agentStacks[msg.sender][baseT].birthBlock = block.number;

        if (!isOccupying[baseT][msg.sender]) {
            stackOccupants[baseT].push(msg.sender);
            isOccupying[baseT][msg.sender] = true;
        }

        if (balanceOf(msg.sender, baseF) == 0 && balanceOf(msg.sender, baseF + 216) == 0) {
            isOccupying[baseF][msg.sender] = false;
            delete agentStacks[msg.sender][baseF]; 
        }
    }

    function _isAdjacent(uint16 c1, uint16 c2) internal pure returns (bool) {
        uint16 v1 = c1 - 1; uint16 v2 = c2 - 1;
        int16 x1 = int16(v1 % 6); int16 y1 = int16((v1 / 6) % 6); int16 z1 = int16(v1 / 36);
        int16 x2 = int16(v2 % 6); int16 y2 = int16((v2 / 6) % 6); int16 z2 = int16(v2 / 36);
        return uint16((x1>x2?x1-x2:x2-x1)+(y1>y2?y1-y2:y2-y1)+(z1>z2?z1-z2:z2-z1)) == 1;
    }

    function getFullStack(uint16 stackId) external view returns (StackInfo[] memory) {
        uint256 unitId = uint256(stackId);
        uint256 reaperId = unitId + 216;
        address[] memory occ = stackOccupants[unitId];
        
        uint256 count = 0;
        for (uint256 i = 0; i < occ.length; i++) {
            if (isOccupying[unitId][occ[i]]) count++;
        }

        StackInfo[] memory info = new StackInfo[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < occ.length; i++) {
            address target = occ[i];
            if (isOccupying[unitId][target]) {
                info[idx] = StackInfo({
                    occupant: target,
                    units: balanceOf(target, unitId),
                    reapers: balanceOf(target, reaperId),
                    age: block.number - agentStacks[target][unitId].birthBlock,
                    pendingBounty: getPendingBounty(target, unitId)
                });
                idx++;
            }
        }
        return info;
    }

    function supportsInterface(bytes4 id) public view virtual override(ERC1155) returns (bool) { 
        return super.supportsInterface(id); 
    }
}