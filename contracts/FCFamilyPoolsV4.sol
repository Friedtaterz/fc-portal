// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ═══════════════════════════════════════════════════════════════════
 * FRACTALCOIN FAMILY POOLS V4 — Open Pools, No Invite Gate
 * ═══════════════════════════════════════════════════════════════════
 *
 * Changes from V3:
 *   - NO invite requirement. Anyone can join any pool.
 *   - Pools are ACTIVE immediately (no need for 10 members).
 *   - Rewards claimable as soon as there are rewards.
 *   - Existing members can deposit more (ETH or FNC).
 *   - Pool still caps at 10 members.
 *
 * FLOW: Connect wallet → Pick pool → Enter amount → Confirm → Done.
 *
 * MONEY FLOW (unchanged):
 *   Deposit → 5% founder fee → 95% split:
 *     - familySplitBps% → Family Pool rewards
 *     - remainder → MainPool liquidity
 *   FC minted 1:1 to depositor
 * ═══════════════════════════════════════════════════════════════════
 */

interface IFCToken {
    function mintForDeposit(address to, uint256 amount) external;
    function mintForFounder(address to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IFNC {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract FCFamilyPoolsV4 {

    struct FamilyPool {
        uint256 id;
        string name;
        address creator;
        address[] members;
        uint256 totalDepositedETH;
        uint256 totalDepositedFNC;
        uint256 totalFCMinted;
        uint256 rewardsAccrued;
        bool isFull;
        bool isActive;
        uint256 createdAt;
    }

    struct MemberInfo {
        uint256 depositedETH;
        uint256 depositedFNC;
        uint256 fcReceived;
        uint256 rewardsClaimed;
        uint256 joinedAt;
    }

    uint256 public constant MAX_MEMBERS = 10;
    uint256 public constant FOUNDER_FEE_BPS = 500;  // 5%
    uint256 public constant MAX_POOLS = 10000;

    IFCToken public fcToken;
    IFNC public fncToken;
    address public owner;
    address public founderWallet;

    uint256 public nextPoolId;
    mapping(uint256 => FamilyPool) public pools;
    mapping(uint256 => mapping(address => MemberInfo)) public memberInfo;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(address => uint256[]) public userPools;

    // Founder logic
    uint256 public hancePoolThreshold = 1000 * 10**18;
    uint256 public hancePoolAccumulated;
    bool public hanceThresholdMet;

    // MainPool
    uint256 public mainPoolETH;
    uint256 public mainPoolFNC;
    uint256 public lastBuybackTime;
    bool public buybackEnabled;
    uint256 public familySplitBps = 9500; // 95% to family pool (fixed from V3)

    // Buyback
    uint256 public buybackCooldown = 1 days;
    uint256 public buybackBps = 1000;
    address public buybackTarget;

    // Events
    event PoolCreated(uint256 indexed poolId, string name, address indexed creator);
    event MemberJoined(uint256 indexed poolId, address indexed member, uint256 ethAmount, uint256 fncAmount, uint256 fcMinted);
    event PoolFull(uint256 indexed poolId);
    event RewardsClaimed(uint256 indexed poolId, address indexed member, uint256 amount);
    event FounderFeeRouted(uint256 amount, address indexed destination, bool toPool);
    event MainPoolDeposit(uint256 ethAmount, uint256 fncAmount);
    event BuybackExecuted(uint256 ethSpent);
    event RewardsDistributed(uint256 indexed poolId, uint256 amount);
    event MemberDeposited(uint256 indexed poolId, address indexed member, uint256 ethAmount, uint256 fncAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "FCP: not owner");
        _;
    }

    constructor(
        address _fcToken,
        address _fncToken,
        address _founderWallet
    ) {
        require(_fcToken != address(0), "FCP: zero FC token");
        require(_founderWallet != address(0), "FCP: zero founder wallet");

        fcToken = IFCToken(_fcToken);
        fncToken = IFNC(_fncToken);
        owner = msg.sender;
        founderWallet = _founderWallet;

        // Create TheHanceFamilyPool as pool #0
        FamilyPool storage pool0 = pools[0];
        pool0.id = 0;
        pool0.name = "TheHanceFamilyPool";
        pool0.creator = _founderWallet;
        pool0.createdAt = block.timestamp;
        pool0.isActive = true; // Active immediately
        pool0.members.push(_founderWallet);
        isMember[0][_founderWallet] = true;
        memberInfo[0][_founderWallet].joinedAt = block.timestamp;
        userPools[_founderWallet].push(0);

        nextPoolId = 1;
        emit PoolCreated(0, "TheHanceFamilyPool", _founderWallet);
    }

    // ═══════════════════════════════════════════════════════════════
    // JOIN — No invite needed. Just pick a pool and deposit.
    // ═══════════════════════════════════════════════════════════════

    /// @notice Join a pool with ETH. One step, one confirm.
    function joinPoolETH(uint256 poolId) external payable {
        require(msg.value > 0, "FCP: zero deposit");
        _joinPool(poolId, msg.sender, msg.value, 0);
    }

    /// @notice Join a pool with FNC (must approve first)
    function joinPoolFNC(uint256 poolId, uint256 fncAmount) external {
        require(fncAmount > 0, "FCP: zero deposit");
        require(address(fncToken) != address(0), "FCP: FNC not configured");
        bool ok = fncToken.transferFrom(msg.sender, address(this), fncAmount);
        require(ok, "FCP: FNC transfer failed");
        _joinPool(poolId, msg.sender, 0, fncAmount);
    }

    /// @notice Join with both ETH and FNC
    function joinPoolDual(uint256 poolId, uint256 fncAmount) external payable {
        require(msg.value > 0 || fncAmount > 0, "FCP: zero deposit");
        if (fncAmount > 0) {
            require(address(fncToken) != address(0), "FCP: FNC not configured");
            bool ok = fncToken.transferFrom(msg.sender, address(this), fncAmount);
            require(ok, "FCP: FNC transfer failed");
        }
        _joinPool(poolId, msg.sender, msg.value, fncAmount);
    }

    function _joinPool(uint256 poolId, address member, uint256 ethAmount, uint256 fncAmount) internal {
        FamilyPool storage pool = pools[poolId];
        require(pool.createdAt > 0, "FCP: pool does not exist");
        require(!pool.isFull, "FCP: pool full");
        require(!isMember[poolId][member], "FCP: already member");

        uint256 totalValue = ethAmount + fncAmount;

        // 5% founder fee
        uint256 founderFee = (totalValue * FOUNDER_FEE_BPS) / 10000;
        uint256 remaining = totalValue - founderFee;
        _routeFounderFee(founderFee, ethAmount, fncAmount);

        // Split remaining 95%
        uint256 familyShare = (remaining * familySplitBps) / 10000;
        uint256 mainPoolShare = remaining - familyShare;

        pool.rewardsAccrued += familyShare;

        if (ethAmount > 0) {
            uint256 ethToMain = (mainPoolShare * ethAmount) / totalValue;
            mainPoolETH += ethToMain;
        }
        if (fncAmount > 0) {
            uint256 fncToMain = (mainPoolShare * fncAmount) / totalValue;
            mainPoolFNC += fncToMain;
        }

        emit MainPoolDeposit(
            ethAmount > 0 ? (mainPoolShare * ethAmount) / totalValue : 0,
            fncAmount > 0 ? (mainPoolShare * fncAmount) / totalValue : 0
        );

        // Mint FC 1:1
        uint256 fcToMint = totalValue;
        fcToken.mintForDeposit(member, fcToMint);

        // Update state
        pool.members.push(member);
        pool.totalDepositedETH += ethAmount;
        pool.totalDepositedFNC += fncAmount;
        pool.totalFCMinted += fcToMint;

        isMember[poolId][member] = true;
        memberInfo[poolId][member] = MemberInfo({
            depositedETH: ethAmount,
            depositedFNC: fncAmount,
            fcReceived: fcToMint,
            rewardsClaimed: 0,
            joinedAt: block.timestamp
        });
        userPools[member].push(poolId);

        if (pool.members.length >= MAX_MEMBERS) {
            pool.isFull = true;
            emit PoolFull(poolId);
        }

        emit MemberJoined(poolId, member, ethAmount, fncAmount, fcToMint);
    }

    // ═══════════════════════════════════════════════════════════════
    // DEPOSIT MORE — Existing members add funds
    // ═══════════════════════════════════════════════════════════════

    /// @notice Deposit more ETH into a pool you're already in
    function depositETH(uint256 poolId) external payable {
        require(msg.value > 0, "FCP: zero deposit");
        require(isMember[poolId][msg.sender], "FCP: not member");
        _deposit(poolId, msg.sender, msg.value, 0);
    }

    /// @notice Deposit more FNC into a pool you're already in
    function depositFNC(uint256 poolId, uint256 fncAmount) external {
        require(fncAmount > 0, "FCP: zero deposit");
        require(isMember[poolId][msg.sender], "FCP: not member");
        require(address(fncToken) != address(0), "FCP: FNC not configured");
        bool ok = fncToken.transferFrom(msg.sender, address(this), fncAmount);
        require(ok, "FCP: FNC transfer failed");
        _deposit(poolId, msg.sender, 0, fncAmount);
    }

    function _deposit(uint256 poolId, address member, uint256 ethAmount, uint256 fncAmount) internal {
        FamilyPool storage pool = pools[poolId];
        uint256 totalValue = ethAmount + fncAmount;

        // 5% founder fee
        uint256 founderFee = (totalValue * FOUNDER_FEE_BPS) / 10000;
        uint256 remaining = totalValue - founderFee;
        _routeFounderFee(founderFee, ethAmount, fncAmount);

        // Split
        uint256 familyShare = (remaining * familySplitBps) / 10000;
        uint256 mainPoolShare = remaining - familyShare;

        pool.rewardsAccrued += familyShare;

        if (ethAmount > 0 && totalValue > 0) {
            mainPoolETH += (mainPoolShare * ethAmount) / totalValue;
        }
        if (fncAmount > 0 && totalValue > 0) {
            mainPoolFNC += (mainPoolShare * fncAmount) / totalValue;
        }

        // Mint FC 1:1
        uint256 fcToMint = totalValue;
        fcToken.mintForDeposit(member, fcToMint);

        // Update
        pool.totalDepositedETH += ethAmount;
        pool.totalDepositedFNC += fncAmount;
        pool.totalFCMinted += fcToMint;

        MemberInfo storage info = memberInfo[poolId][member];
        info.depositedETH += ethAmount;
        info.depositedFNC += fncAmount;
        info.fcReceived += fcToMint;

        emit MemberDeposited(poolId, member, ethAmount, fncAmount);
    }

    // ═══════════════════════════════════════════════════════════════
    // POOL CREATION
    // ═══════════════════════════════════════════════════════════════

    /// @notice Create a pool. You auto-join. Share the pool ID and anyone can join.
    function createPool(string calldata poolName) external returns (uint256 poolId) {
        require(nextPoolId < MAX_POOLS, "FCP: max pools reached");

        poolId = nextPoolId++;
        FamilyPool storage pool = pools[poolId];
        pool.id = poolId;
        pool.name = poolName;
        pool.creator = msg.sender;
        pool.createdAt = block.timestamp;
        pool.isActive = true; // Active immediately — no waiting for 10 members

        pool.members.push(msg.sender);
        isMember[poolId][msg.sender] = true;
        memberInfo[poolId][msg.sender].joinedAt = block.timestamp;
        userPools[msg.sender].push(poolId);

        emit PoolCreated(poolId, poolName, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════
    // REWARDS — Claimable anytime, no 10-member gate
    // ═══════════════════════════════════════════════════════════════

    function distributeRewards(uint256 poolId, uint256 amount) external onlyOwner {
        require(pools[poolId].createdAt > 0, "FCP: pool does not exist");
        fcToken.mintForFounder(address(this), amount);
        pools[poolId].rewardsAccrued += amount;
        emit RewardsDistributed(poolId, amount);
    }

    function claimRewards(uint256 poolId) external {
        require(isMember[poolId][msg.sender], "FCP: not member");
        FamilyPool storage pool = pools[poolId];

        MemberInfo storage info = memberInfo[poolId][msg.sender];
        uint256 memberTotal = info.depositedETH + info.depositedFNC;
        uint256 poolTotal = pool.totalDepositedETH + pool.totalDepositedFNC;
        if (poolTotal == 0) return;

        uint256 totalEntitlement = (pool.rewardsAccrued * memberTotal) / poolTotal;
        uint256 claimable = totalEntitlement > info.rewardsClaimed ?
            totalEntitlement - info.rewardsClaimed : 0;
        if (claimable == 0) return;

        info.rewardsClaimed += claimable;
        bool ok = fcToken.transfer(msg.sender, claimable);
        require(ok, "FCP: reward transfer failed");

        emit RewardsClaimed(poolId, msg.sender, claimable);
    }

    // ═══════════════════════════════════════════════════════════════
    // FOUNDER FEE ROUTING
    // ═══════════════════════════════════════════════════════════════

    function _routeFounderFee(uint256 feeValue, uint256 ethPortion, uint256 fncPortion) internal {
        if (feeValue == 0) return;

        if (!hanceThresholdMet) {
            hancePoolAccumulated += feeValue;
            pools[0].rewardsAccrued += feeValue;
            if (hancePoolAccumulated >= hancePoolThreshold) {
                hanceThresholdMet = true;
            }
            emit FounderFeeRouted(feeValue, address(this), true);
        } else {
            uint256 totalDeposit = ethPortion + fncPortion;
            if (totalDeposit == 0) return;

            if (ethPortion > 0) {
                uint256 ethFee = (feeValue * ethPortion) / totalDeposit;
                if (ethFee > 0) {
                    (bool sent, ) = founderWallet.call{value: ethFee}("");
                    require(sent, "FCP: ETH fee transfer failed");
                }
            }
            if (fncPortion > 0 && address(fncToken) != address(0)) {
                uint256 fncFee = (feeValue * fncPortion) / totalDeposit;
                if (fncFee > 0) {
                    fncToken.transfer(founderWallet, fncFee);
                }
            }
            emit FounderFeeRouted(feeValue, founderWallet, false);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // BUYBACK
    // ═══════════════════════════════════════════════════════════════

    function executeBuyback() external {
        require(buybackEnabled, "FCP: buyback disabled");
        require(block.timestamp >= lastBuybackTime + buybackCooldown, "FCP: cooldown");
        require(mainPoolETH > 0, "FCP: no ETH in main pool");
        require(buybackTarget != address(0), "FCP: no buyback target set");

        uint256 buybackAmount = (mainPoolETH * buybackBps) / 10000;
        require(buybackAmount > 0, "FCP: buyback amount too small");

        mainPoolETH -= buybackAmount;
        lastBuybackTime = block.timestamp;

        (bool sent, ) = buybackTarget.call{value: buybackAmount}("");
        require(sent, "FCP: buyback transfer failed");
        emit BuybackExecuted(buybackAmount);
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════

    function setFamilySplitBps(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "FCP: max 100%");
        familySplitBps = _bps;
    }

    function setBuybackEnabled(bool _enabled) external onlyOwner {
        buybackEnabled = _enabled;
    }

    function setBuybackTarget(address _target) external onlyOwner {
        require(_target != address(0), "FCP: zero target");
        buybackTarget = _target;
    }

    function setBuybackParams(uint256 _cooldown, uint256 _bps) external onlyOwner {
        require(_bps <= 5000, "FCP: max 50% per buyback");
        require(_cooldown >= 1 hours, "FCP: min 1 hour cooldown");
        buybackCooldown = _cooldown;
        buybackBps = _bps;
    }

    function setFounderWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "FCP: zero address");
        founderWallet = _wallet;
    }

    function setHanceThreshold(uint256 _threshold) external onlyOwner {
        require(!hanceThresholdMet, "FCP: threshold already met");
        hancePoolThreshold = _threshold;
    }

    function setFNCToken(address _fncToken) external onlyOwner {
        fncToken = IFNC(_fncToken);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "FCP: zero address");
        owner = newOwner;
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS — same interface as V3 so frontend works
    // ═══════════════════════════════════════════════════════════════

    function getPoolInfo(uint256 poolId) external view returns (
        string memory poolName, address creator, uint256 memberCount,
        uint256 totalETH, uint256 totalFNC, uint256 totalFC,
        uint256 rewards, bool isFull, bool isActive, uint256 createdAt
    ) {
        FamilyPool storage pool = pools[poolId];
        return (pool.name, pool.creator, pool.members.length,
            pool.totalDepositedETH, pool.totalDepositedFNC, pool.totalFCMinted,
            pool.rewardsAccrued, pool.isFull, pool.isActive, pool.createdAt);
    }

    function getPoolMembers(uint256 poolId) external view returns (address[] memory) {
        return pools[poolId].members;
    }

    function getMemberInfo(uint256 poolId, address member) external view returns (
        uint256 depositedETH, uint256 depositedFNC, uint256 fcReceived,
        uint256 rewardsClaimed, uint256 joinedAt
    ) {
        MemberInfo storage info = memberInfo[poolId][member];
        return (info.depositedETH, info.depositedFNC, info.fcReceived,
            info.rewardsClaimed, info.joinedAt);
    }

    function getUserPools(address user) external view returns (uint256[] memory) {
        return userPools[user];
    }

    function getClaimable(uint256 poolId, address member) external view returns (uint256) {
        if (!isMember[poolId][member]) return 0;
        FamilyPool storage pool = pools[poolId];

        MemberInfo storage info = memberInfo[poolId][member];
        uint256 memberTotal = info.depositedETH + info.depositedFNC;
        uint256 poolTotal = pool.totalDepositedETH + pool.totalDepositedFNC;
        if (poolTotal == 0) return 0;

        uint256 totalEntitlement = (pool.rewardsAccrued * memberTotal) / poolTotal;
        return totalEntitlement > info.rewardsClaimed ?
            totalEntitlement - info.rewardsClaimed : 0;
    }

    function mainPoolStatus() external view returns (
        uint256 ethBalance, uint256 fncBalance, bool _buybackEnabled
    ) {
        return (mainPoolETH, mainPoolFNC, buybackEnabled);
    }

    function founderStatus() external view returns (
        address wallet, uint256 accumulated, uint256 threshold, bool thresholdMet
    ) {
        return (founderWallet, hancePoolAccumulated, hancePoolThreshold, hanceThresholdMet);
    }

    function totalPools() external view returns (uint256) {
        return nextPoolId;
    }

    receive() external payable {
        mainPoolETH += msg.value;
        emit MainPoolDeposit(msg.value, 0);
    }
}
