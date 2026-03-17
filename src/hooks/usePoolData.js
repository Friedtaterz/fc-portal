import { useState, useEffect, useCallback } from 'react';
import { getBaseRPC, FC_POOLS, FC_TOKEN, FNC_TOKEN } from '../config';

// ─── RPC helpers (with retry + round-robin) ──────────────
async function rpcCall(to, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
      const res = await fetch(getBaseRPC(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      const json = await res.json();
      if (json.error) {
        if (json.error.message?.includes('rate limit') && attempt < 2) continue;
        throw new Error(json.error.message);
      }
      return json.result;
    } catch (e) {
      if (attempt === 2) throw e;
      if (!e.message?.includes('rate limit') && !e.message?.includes('1015')) throw e;
    }
  }
}

// Decode helpers
function decU(hex, offset = 0) {
  const start = 2 + offset * 64;
  return Number(BigInt('0x' + (hex.slice(start, start + 64) || '0')));
}

function decU256(hex, offset = 0) {
  const start = 2 + offset * 64;
  return BigInt('0x' + (hex.slice(start, start + 64) || '0'));
}

function decAddr(hex, offset = 0) {
  const start = 2 + offset * 64;
  return '0x' + hex.slice(start + 24, start + 64);
}

function decBool(hex, offset = 0) {
  return decU(hex, offset) !== 0;
}

// Decode ABI-encoded string (dynamic type at slot position)
function decString(hex, baseOffset = 0) {
  const ptrSlot = 2 + baseOffset * 64;
  const ptr = Number(BigInt('0x' + hex.slice(ptrSlot, ptrSlot + 64)));
  const dataStart = 2 + ptr * 2;
  const len = Number(BigInt('0x' + hex.slice(dataStart, dataStart + 64)));
  const strHex = hex.slice(dataStart + 64, dataStart + 64 + len * 2);
  let str = '';
  for (let i = 0; i < strHex.length; i += 2) {
    str += String.fromCharCode(parseInt(strHex.slice(i, i + 2), 16));
  }
  return str;
}

function encAddr(addr) { return addr.slice(2).toLowerCase().padStart(64, '0'); }

// Function selectors (keccak256 verified)
const SEL = {
  nextPoolId:     '0x18e56131',
  getPoolInfo:    '0x2f380b35',
  founderStatus:  '0x28cf11c3',
  mainPoolStatus: '0x114f34f1',
  isMember:       '0x7d9e10f5',
  memberInfo:     '0x07e079d3',
  createPool:     '0xd0d13036',
  joinPoolETH:    '0xb33fa210',
  // V2 invite selectors
  inviteToPool:   '0xa54d2164',
  inviteBatch:    '0xe8bb656e',
  revokeInvite:   '0x87b67393',
  isInvited:      '0x12e81b80',
  // Deposit more (existing members)
  depositETH:     '0x5358fbda',
  depositFNC:     '0xbe2c4e29',
  joinPoolFNC:    '0x7908250d',
  // V2 member/pool metrics
  getMemberInfo:  '0x1e67939e',
  getUserPools:   '0x9816af58',
  getClaimable:   '0xb961cbe1',
  claimRewards:   '0x0962ef79',
  distributeRewards: '0xdf6c39fb',
};

// ─── Read pool data ─────────────────────────────────────
async function fetchPoolInfo(poolId) {
  try {
    const data = SEL.getPoolInfo + poolId.toString(16).padStart(64, '0');
    const result = await rpcCall(FC_POOLS, data);
    if (!result || result === '0x') return null;

    const name = decString(result, 0);
    const creator = decAddr(result, 1);
    const memberCount = decU(result, 2);
    const totalETH = Number(decU256(result, 3)) / 1e18;
    const totalFNC = Number(decU256(result, 4)) / 1e18;
    const totalFCMinted = Number(decU256(result, 5)) / 1e18;
    const rewardsAccrued = Number(decU256(result, 6)) / 1e18;
    const isFull = decBool(result, 7);
    const isActive = decBool(result, 8);
    const createdAt = decU(result, 9);

    if (createdAt === 0 && memberCount === 0 && name === '') return null;

    return {
      id: poolId, name, creator, memberCount,
      totalETH, totalFNC, totalFCMinted, rewardsAccrued,
      isFull, isActive, createdAt,
    };
  } catch (e) {
    console.warn('[PoolData] fetchPoolInfo error for pool', poolId, e.message);
    return null;
  }
}

async function fetchFounderStatus() {
  try {
    const result = await rpcCall(FC_POOLS, SEL.founderStatus);
    return {
      accumulated: Number(decU256(result, 1)) / 1e18,
      threshold: Number(decU256(result, 2)) / 1e18,
      thresholdMet: decBool(result, 3),
    };
  } catch {
    return null;
  }
}

async function fetchMainPoolStatus() {
  try {
    const result = await rpcCall(FC_POOLS, SEL.mainPoolStatus);
    return {
      mainPoolETH: Number(decU256(result, 0)) / 1e18,
      mainPoolFNC: Number(decU256(result, 1)) / 1e18,
      buybackEnabled: decBool(result, 2),
    };
  } catch {
    return null;
  }
}

async function checkMembership(poolId, account) {
  if (!account) return false;
  try {
    const data = SEL.isMember
      + poolId.toString(16).padStart(64, '0')
      + encAddr(account);
    const result = await rpcCall(FC_POOLS, data);
    return decBool(result, 0);
  } catch {
    return false;
  }
}

// ─── Member metrics ─────────────────────────────────────
export async function fetchMemberInfo(poolId, account) {
  if (!account) return null;
  try {
    const data = SEL.getMemberInfo
      + poolId.toString(16).padStart(64, '0')
      + encAddr(account);
    const result = await rpcCall(FC_POOLS, data);
    // Returns: (depositedETH, depositedFNC, fcReceived, rewardsClaimed, joinedAt)
    return {
      depositedETH: Number(decU256(result, 0)) / 1e18,
      depositedFNC: Number(decU256(result, 1)) / 1e18,
      fcReceived: Number(decU256(result, 2)) / 1e18,
      rewardsClaimed: Number(decU256(result, 3)) / 1e18,
      joinedAt: decU(result, 4),
    };
  } catch {
    return null;
  }
}

export async function fetchClaimable(poolId, account) {
  if (!account) return 0;
  try {
    const data = SEL.getClaimable
      + poolId.toString(16).padStart(64, '0')
      + encAddr(account);
    const result = await rpcCall(FC_POOLS, data);
    return Number(decU256(result, 0)) / 1e18;
  } catch {
    return 0;
  }
}

export async function fetchUserPools(account) {
  if (!account) return [];
  try {
    const data = SEL.getUserPools + encAddr(account);
    const result = await rpcCall(FC_POOLS, data);
    // Dynamic array: offset at slot 0, then length, then elements
    const ptr = Number(decU256(result, 0));
    const dataStart = 2 + ptr * 2;
    const len = Number(BigInt('0x' + result.slice(dataStart, dataStart + 64)));
    const ids = [];
    for (let i = 0; i < len; i++) {
      ids.push(Number(BigInt('0x' + result.slice(dataStart + 64 + i * 64, dataStart + 128 + i * 64))));
    }
    return ids;
  } catch {
    return [];
  }
}

// ─── Main hook ──────────────────────────────────────────
export function usePoolData(account) {
  const [pools, setPools] = useState([]);
  const [founder, setFounder] = useState(null);
  const [mainPool, setMainPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState({});
  const [myMetrics, setMyMetrics] = useState({});

  const poll = useCallback(async () => {
    try {
      let totalPools = 1;
      try {
        const result = await rpcCall(FC_POOLS, SEL.nextPoolId);
        totalPools = decU(result, 0);
        if (totalPools < 1) totalPools = 1;
      } catch {
        // Keep trying with at least 1 pool
      }

      // Fetch pools sequentially with delays to avoid rate limits
      const validPools = [];
      for (let i = 0; i < totalPools; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 500));
        const p = await fetchPoolInfo(i);
        if (p) validPools.push(p);
      }

      // Only update if we got results — never reset to empty
      if (validPools.length > 0) {
        setPools(validPools);
      }

      if (account && validPools.length > 0) {
        const memChecks = {};
        const metrics = {};
        for (const p of validPools) {
          await new Promise(r => setTimeout(r, 500));
          memChecks[p.id] = await checkMembership(p.id, account);
          if (memChecks[p.id]) {
            await new Promise(r => setTimeout(r, 500));
            const info = await fetchMemberInfo(p.id, account);
            await new Promise(r => setTimeout(r, 500));
            const claimable = await fetchClaimable(p.id, account);
            const totalDeposit = (info?.depositedETH || 0) + (info?.depositedFNC || 0);
            const poolTotal = p.totalETH + p.totalFNC;
            const sharePercent = poolTotal > 0 ? (totalDeposit / poolTotal) * 100 : 0;
            metrics[p.id] = { ...info, claimable, sharePercent };
          }
        }
        setMembership(memChecks);
        setMyMetrics(metrics);
      }

      await new Promise(r => setTimeout(r, 500));
      try {
        const fStatus = await fetchFounderStatus();
        if (fStatus) setFounder(fStatus);
      } catch {}

      await new Promise(r => setTimeout(r, 500));
      try {
        const mStatus = await fetchMainPoolStatus();
        if (mStatus) setMainPool(mStatus);
      } catch {}

      setLoading(false);
    } catch (err) {
      console.warn('[PoolData] Error:', err.message);
      setLoading(false);
      // Don't reset state — keep showing last good data
    }
  }, [account]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 60_000); // every 60s to avoid rate limits
    return () => clearInterval(interval);
  }, [poll]);

  return { pools, founder, mainPool, loading, membership, myMetrics, refresh: poll };
}

// ─── Write functions (need MetaMask) ────────────────────
export async function createPool(poolName) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const nameBytes = new TextEncoder().encode(poolName);
  const nameHex = Array.from(nameBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const namePadded = nameHex.padEnd(Math.ceil(nameHex.length / 64) * 64, '0');

  const data = SEL.createPool
    + '0000000000000000000000000000000000000000000000000000000000000020'
    + nameBytes.length.toString(16).padStart(64, '0')
    + namePadded;

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (200000).toString(16),
    }],
  });
  return txHash;
}

export async function joinPoolETH(poolId, ethAmount) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const data = SEL.joinPoolETH + poolId.toString(16).padStart(64, '0');
  const value = '0x' + BigInt(Math.floor(ethAmount * 1e18)).toString(16);

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      value,
      gas: '0x' + (300000).toString(16),
    }],
  });
  return txHash;
}

export async function claimRewards(poolId) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const data = SEL.claimRewards + poolId.toString(16).padStart(64, '0');

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (150000).toString(16),
    }],
  });
  return txHash;
}

// ─── Distribute Rewards (owner only — mints FC into pool contract) ──
export async function distributeRewards(poolId, fcAmount) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const amountWei = BigInt(Math.floor(fcAmount)) * BigInt('1000000000000000000');
  const data = SEL.distributeRewards
    + poolId.toString(16).padStart(64, '0')
    + amountWei.toString(16).padStart(64, '0');

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (200000).toString(16),
    }],
  });
  return txHash;
}

// ─── Deposit more (existing members) ─────────────────────
export async function depositETH(poolId, ethAmount) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const data = SEL.depositETH + poolId.toString(16).padStart(64, '0');
  const value = '0x' + BigInt(Math.floor(ethAmount * 1e18)).toString(16);

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      value,
      gas: '0x' + (300000).toString(16),
    }],
  });
  return txHash;
}

export async function checkFNCAllowance() {
  if (!window.ethereum) return 0;
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) return 0;
  try {
    const data = '0xdd62ed3e'
      + accounts[0].slice(2).toLowerCase().padStart(64, '0')
      + FC_POOLS.slice(2).toLowerCase().padStart(64, '0');
    const result = await rpcCall(FNC_TOKEN, data);
    return Number(BigInt('0x' + (result || '0').slice(2))) / 1e18;
  } catch { return 0; }
}

export async function approveFNC() {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const maxUint = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const data = '0x095ea7b3'
    + FC_POOLS.slice(2).toLowerCase().padStart(64, '0')
    + maxUint;

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FNC_TOKEN,
      data,
      gas: '0x' + (60000).toString(16),
    }],
  });

  // Wait for confirmation
  let confirmed = false;
  const start = Date.now();
  while (!confirmed && Date.now() - start < 60000) {
    try {
      const receipt = await window.ethereum.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      });
      if (receipt) {
        if (receipt.status === '0x0') throw new Error('Approval failed');
        confirmed = true;
      }
    } catch (e) { if (e.message.includes('failed')) throw e; }
    if (!confirmed) await new Promise(r => setTimeout(r, 2000));
  }
  if (!confirmed) throw new Error('Approval timed out');
  return txHash;
}

export async function depositFNC(poolId, fncAmount) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  // Use BigInt math to avoid JS number overflow for large amounts
  const whole = BigInt(Math.floor(fncAmount));
  const amountWei = whole * BigInt('1000000000000000000');
  const amountHex = amountWei.toString(16).padStart(64, '0');

  const data = SEL.depositFNC
    + poolId.toString(16).padStart(64, '0')
    + amountHex;

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (500000).toString(16),
    }],
  });
  return txHash;
}

// ─── V2 Invite functions ─────────────────────────────────
export async function inviteToPool(poolId, memberAddress) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const data = SEL.inviteToPool
    + poolId.toString(16).padStart(64, '0')
    + memberAddress.slice(2).toLowerCase().padStart(64, '0');

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (100000).toString(16),
    }],
  });
  return txHash;
}

export async function inviteBatch(poolId, addresses) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const poolHex = poolId.toString(16).padStart(64, '0');
  const offsetHex = (64).toString(16).padStart(64, '0');
  const lenHex = addresses.length.toString(16).padStart(64, '0');
  const addrsHex = addresses.map(a => a.slice(2).toLowerCase().padStart(64, '0')).join('');

  const data = SEL.inviteBatch + poolHex + offsetHex + lenHex + addrsHex;

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (50000 + addresses.length * 30000).toString(16),
    }],
  });
  return txHash;
}

export async function revokeInvite(poolId, memberAddress) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const data = SEL.revokeInvite
    + poolId.toString(16).padStart(64, '0')
    + memberAddress.slice(2).toLowerCase().padStart(64, '0');

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (80000).toString(16),
    }],
  });
  return txHash;
}

// ─── Admin: Fix family split (owner only) ─────────────────
export async function setFamilySplitBps(bps) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');

  const data = '0x5c9f3a95' + bps.toString(16).padStart(64, '0');

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: accounts[0],
      to: FC_POOLS,
      data,
      gas: '0x' + (60000).toString(16),
    }],
  });
  return txHash;
}

export async function getFamilySplitBps() {
  try {
    const result = await rpcCall(FC_POOLS, '0xe84faf2d');
    return Number(BigInt(result));
  } catch {
    return null;
  }
}

export async function checkInvited(poolId, account) {
  if (!account) return false;
  try {
    const data = SEL.isInvited
      + poolId.toString(16).padStart(64, '0')
      + account.slice(2).toLowerCase().padStart(64, '0');
    const result = await rpcCall(FC_POOLS, data);
    return decBool(result, 0);
  } catch {
    return false;
  }
}
