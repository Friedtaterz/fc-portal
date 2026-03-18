import React, { useState } from 'react';
import StatCard from '../components/StatCard';
import ProgressBar from '../components/ProgressBar';
import { BASESCAN_POOLS, BASESCAN_TOKEN } from '../config';
import { usePoolData, joinPoolETH, joinPoolFNC, createPool, claimRewards, depositETH, depositFNC, approveFNC, distributeRewards, inviteToPool, revokeInvite, checkInvited } from '../hooks/usePoolData';
import { useDirectorAI } from '../hooks/useDirectorAI';

const fmt = (n, d = 2) => n?.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) || '0';

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp * 1000;
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h ago`;
  return 'just now';
}

// ─── Pool Card — Simple: Join or Deposit, that's it ────────
function PoolCard({ pool, isMember, wallet, isCreator, myMetrics, onRefresh }) {
  const [amount, setAmount] = useState('');
  const [joining, setJoining] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [depositAmt, setDepositAmt] = useState('');
  const [depositType, setDepositType] = useState('eth');
  const [rewardAmt, setRewardAmt] = useState('');
  const [distributing, setDistributing] = useState(false);
  const [joinMode, setJoinMode] = useState('eth'); // 'eth' | 'fnc'
  const [fncAmount, setFncAmount] = useState('');
  const [inviteAddr, setInviteAddr] = useState('');
  const [inviting, setInviting] = useState(false);
  const [invitedList, setInvitedList] = useState([]);
  const [result, setResult] = useState(null);
  const isHance = pool.id === 0;
  const m = myMetrics;

  const handleDistribute = async () => {
    const amt = parseFloat(rewardAmt);
    if (!amt || amt <= 0) { setResult({ ok: false, msg: 'Enter an FC amount' }); return; }
    setDistributing(true); setResult(null);
    try {
      const tx = await distributeRewards(pool.id, amt);
      setResult({ ok: true, msg: `Distributed ${amt} FC to pool! TX: ${tx.slice(0, 10)}...` });
      setRewardAmt('');
      setTimeout(() => onRefresh?.(), 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected' });
      else if (msg.includes('not owner')) setResult({ ok: false, msg: 'Only contract owner can distribute rewards' });
      else if (msg.includes('founder cap')) setResult({ ok: false, msg: 'Founder mint cap reached' });
      else setResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setDistributing(false);
  };

  const handleJoin = async () => {
    if (joinMode === 'eth') {
      const eth = parseFloat(amount);
      if (!eth || eth <= 0) { setResult({ ok: false, msg: 'Enter an ETH amount' }); return; }
      if (eth > 0.01 && !window.confirm(`You are about to deposit ${eth} ETH. Continue?`)) return;
      setJoining(true); setResult(null);
      try {
        const tx = await joinPoolETH(pool.id, eth);
        setResult({ ok: true, msg: `Joined! TX: ${tx.slice(0, 10)}...` });
        setAmount('');
        setTimeout(() => onRefresh?.(), 5000);
      } catch (err) {
        const msg = err.message || '';
        if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
        else setResult({ ok: false, msg: msg.slice(0, 100) });
      }
      setJoining(false);
    } else {
      // FNC join
      const fnc = parseFloat(fncAmount);
      if (!fnc || fnc <= 0) { setResult({ ok: false, msg: 'Enter an FNC amount' }); return; }
      if (fnc > 100 && !window.confirm(`You are about to deposit ${fnc} FNC. Continue?`)) return;
      setJoining(true); setResult(null);
      try {
        setResult({ ok: true, msg: 'Approving FNC for pool contract... confirm in wallet' });
        try { await approveFNC(); } catch (approveErr) {
          if (approveErr.message?.includes('4001') || approveErr.message?.includes('rejected')) throw approveErr;
        }
        setResult({ ok: true, msg: 'Joining pool with FNC... confirm in wallet' });
        const tx = await joinPoolFNC(pool.id, fnc);
        setResult({ ok: true, msg: `Joined! TX: ${tx.slice(0, 10)}...` });
        setFncAmount('');
        setTimeout(() => onRefresh?.(), 5000);
      } catch (err) {
        const msg = err.message || '';
        if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
        else setResult({ ok: false, msg: msg.slice(0, 100) });
      }
      setJoining(false);
    }
  };

  const handleInvite = async () => {
    const addr = inviteAddr.trim();
    if (!addr || !addr.startsWith('0x') || addr.length !== 42) { setResult({ ok: false, msg: 'Enter a valid wallet address' }); return; }
    setInviting(true); setResult(null);
    try {
      const tx = await inviteToPool(pool.id, addr);
      setResult({ ok: true, msg: `Invited! TX: ${tx.slice(0, 10)}...` });
      setInvitedList(prev => [...prev, addr.toLowerCase()]);
      setInviteAddr('');
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
      else setResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setInviting(false);
  };

  const handleRevoke = async (addr) => {
    if (!window.confirm(`Revoke invite for ${addr.slice(0, 6)}...${addr.slice(-4)}?`)) return;
    setResult(null);
    try {
      const tx = await revokeInvite(pool.id, addr);
      setResult({ ok: true, msg: `Revoked! TX: ${tx.slice(0, 10)}...` });
      setInvitedList(prev => prev.filter(a => a !== addr.toLowerCase()));
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
      else setResult({ ok: false, msg: msg.slice(0, 100) });
    }
  };

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmt);
    if (!amt || amt <= 0) { setResult({ ok: false, msg: `Enter a ${depositType.toUpperCase()} amount` }); return; }
    if (depositType === 'eth' && amt > 0.01 && !window.confirm(`You are about to deposit ${amt} ETH. Continue?`)) return;
    if (depositType === 'fnc' && amt > 100 && !window.confirm(`You are about to deposit ${amt} FNC. Continue?`)) return;
    setDepositing(true); setResult(null);
    try {
      let tx;
      if (depositType === 'eth') {
        tx = await depositETH(pool.id, amt);
      } else {
        // FNC — approve first if needed, then deposit
        setResult({ ok: true, msg: 'Approving FNC for pool contract... confirm in wallet' });
        try {
          await approveFNC();
        } catch (approveErr) {
          if (approveErr.message?.includes('4001') || approveErr.message?.includes('rejected')) throw approveErr;
          // Already approved or approval not needed, continue
        }
        setResult({ ok: true, msg: 'Depositing FNC... confirm in wallet' });
        tx = await depositFNC(pool.id, amt);
      }
      setResult({ ok: true, msg: `Deposited! TX: ${tx.slice(0, 10)}...` });
      setDepositAmt('');
      setTimeout(() => onRefresh?.(), 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
      else setResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setDepositing(false);
  };

  const handleClaim = async () => {
    setClaiming(true); setResult(null);
    try {
      const tx = await claimRewards(pool.id);
      setResult({ ok: true, msg: `Claimed! TX: ${tx.slice(0, 10)}...` });
      setTimeout(() => onRefresh?.(), 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
      else setResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setClaiming(false);
  };

  const canJoin = wallet.account && wallet.isBase && !isMember && pool.isActive && !pool.isFull;

  return (
    <div className={'pool-card' + (isHance ? ' pool-featured' : '')}>
      {isHance && <div className="pool-badge">Founder Pool</div>}
      <div className="pool-card-header">
        <h3>{pool.name || `Pool #${pool.id}`}</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pool-id-tag">ID: {pool.id}</span>
          {isCreator && <span className="pool-creator-tag">Your Pool</span>}
          {isMember && <span className="pool-member-badge" style={{ padding: '3px 10px', fontSize: 11 }}>Member</span>}
        </div>
      </div>

      {/* Pool Stats */}
      <div className="pool-metrics-section">
        <div className="pool-stats-row">
          <div className="pool-stat">
            <span className="pool-stat-label">Members</span>
            <span className="pool-stat-value">{pool.memberCount}<span className="pool-stat-unit">/10</span></span>
          </div>
          <div className="pool-stat">
            <span className="pool-stat-label">Total ETH</span>
            <span className="pool-stat-value">{fmt(pool.totalETH, 6)}</span>
          </div>
          <div className="pool-stat">
            <span className="pool-stat-label">FC Minted</span>
            <span className="pool-stat-value">{fmt(pool.totalFCMinted, 2)}</span>
          </div>
          <div className="pool-stat">
            <span className="pool-stat-label">Rewards</span>
            <span className="pool-stat-value highlight">{fmt(pool.rewardsAccrued, 2)} <span className="pool-stat-unit">FC</span></span>
          </div>
        </div>
        <div className="pool-capacity">
          <div className="pool-capacity-bar">
            <div className="pool-capacity-fill" style={{ width: `${(pool.memberCount / 10) * 100}%` }} />
          </div>
          <span className="pool-capacity-label">{pool.memberCount}/10 members</span>
        </div>
      </div>

      {/* ── JOIN — ETH or FNC ── */}
      {canJoin && (
        <div className="pool-join">
          <div className="pool-deposit-toggle" style={{ marginBottom: 8 }}>
            <button onClick={() => setJoinMode('eth')} className={'btn btn-sm ' + (joinMode === 'eth' ? 'btn-primary' : 'btn-outline')}>Join with ETH</button>
            <button onClick={() => setJoinMode('fnc')} className={'btn btn-sm ' + (joinMode === 'fnc' ? 'btn-primary' : 'btn-outline')}>Join with FNC</button>
          </div>
          <div className="pool-join-row">
            {joinMode === 'eth' ? (
              <input type="number" step="0.001" min="0" placeholder="ETH amount" value={amount} onChange={e => setAmount(e.target.value)} className="pool-input" />
            ) : (
              <input type="number" step="1" min="0" placeholder="FNC amount" value={fncAmount} onChange={e => setFncAmount(e.target.value)} className="pool-input" />
            )}
            <button onClick={handleJoin} disabled={joining} className="btn btn-primary">{joining ? 'Joining...' : 'Join Pool'}</button>
          </div>
          <div className="pool-join-note">{joinMode === 'eth' ? '5% ecosystem fee. Gas under $0.01 on Base.' : 'Approve FNC, then join. Gas under $0.01 on Base.'}</div>
        </div>
      )}

      {/* Pool full */}
      {wallet.account && wallet.isBase && !isMember && pool.isFull && (
        <div className="pool-join"><div className="pool-full-badge">Pool is full</div></div>
      )}

      {/* ── MEMBER VIEW — Your position + deposit more + claim ── */}
      {isMember && wallet.account && wallet.isBase && (
        <div className="pool-metrics-section pool-personal">
          <h4 className="pool-metrics-title">Your Position</h4>
          {m && (
            <div className="pool-stats-row">
              <div className="pool-stat">
                <span className="pool-stat-label">Your ETH</span>
                <span className="pool-stat-value">{fmt(m.depositedETH, 6)}</span>
              </div>
              <div className="pool-stat">
                <span className="pool-stat-label">FC Received</span>
                <span className="pool-stat-value">{fmt(m.fcReceived, 2)}</span>
              </div>
              <div className="pool-stat">
                <span className="pool-stat-label">Pool Share</span>
                <span className="pool-stat-value highlight">{fmt(m.sharePercent, 1)}<span className="pool-stat-unit">%</span></span>
              </div>
              <div className="pool-stat">
                <span className="pool-stat-label">Claimed</span>
                <span className="pool-stat-value">{fmt(m.rewardsClaimed, 2)} <span className="pool-stat-unit">FC</span></span>
              </div>
            </div>
          )}

          {/* Claim rewards */}
          {m && m.claimable > 0 && (
            <div className="pool-claim-section">
              <div className="pool-claim-info">
                <span className="pool-claim-amount">{fmt(m.claimable, 4)} FC</span>
                <span className="pool-claim-label">available to claim</span>
              </div>
              <button onClick={handleClaim} disabled={claiming} className="btn btn-primary">
                {claiming ? 'Claiming...' : 'Claim Rewards'}
              </button>
            </div>
          )}

          {/* Deposit more */}
          <div className="pool-deposit-section">
            <div className="pool-deposit-toggle" style={{ marginBottom: 8 }}>
              <button onClick={() => setDepositType('eth')} className={'btn btn-sm ' + (depositType === 'eth' ? 'btn-primary' : 'btn-outline')}>ETH</button>
              <button onClick={() => setDepositType('fnc')} className={'btn btn-sm ' + (depositType === 'fnc' ? 'btn-primary' : 'btn-outline')}>FNC</button>
            </div>
            <div className="pool-join-row">
              <input type="number" step={depositType === 'eth' ? '0.001' : '1'} min="0" placeholder={`${depositType.toUpperCase()} amount`} value={depositAmt} onChange={e => setDepositAmt(e.target.value)} className="pool-input" />
              <button onClick={handleDeposit} disabled={depositing} className="btn btn-primary btn-sm">{depositing ? 'Depositing...' : 'Deposit'}</button>
            </div>
            <div className="pool-join-note">5% ecosystem fee. Grows your pool share.</div>
          </div>
        </div>
      )}

      {/* ── OWNER: Fund Rewards ── */}
      {isCreator && wallet.account && wallet.isBase && (
        <div className="pool-metrics-section" style={{ borderColor: 'rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.04)' }}>
          <h4 className="pool-metrics-title" style={{ color: '#f59e0b' }}>Fund Rewards (Owner)</h4>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Mints FC into the pool contract so members can claim rewards.</p>
          <div className="pool-join-row">
            <input type="number" step="100" min="1" placeholder="FC amount to distribute" value={rewardAmt} onChange={e => setRewardAmt(e.target.value)} className="pool-input" />
            <button onClick={handleDistribute} disabled={distributing} className="btn btn-primary btn-sm">{distributing ? 'Distributing...' : 'Fund Rewards'}</button>
          </div>
        </div>
      )}

      {/* ── CREATOR: Invite Members ── */}
      {isCreator && wallet.account && wallet.isBase && (
        <div className="pool-metrics-section" style={{ borderColor: 'rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)' }}>
          <h4 className="pool-metrics-title" style={{ color: '#7c3aed' }}>Invite Members</h4>
          <div className="pool-join-row">
            <input type="text" placeholder="0x... wallet address" value={inviteAddr} onChange={e => setInviteAddr(e.target.value)} className="pool-input" style={{ fontFamily: 'monospace', fontSize: 12 }} />
            <button onClick={handleInvite} disabled={inviting} className="btn btn-primary btn-sm">{inviting ? 'Inviting...' : 'Invite'}</button>
          </div>
          {invitedList.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Invited:</div>
              {invitedList.map(addr => (
                <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, fontFamily: 'monospace' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{addr.slice(0, 6)}...{addr.slice(-4)}</span>
                  <button onClick={() => handleRevoke(addr)} className="btn btn-sm btn-outline" style={{ padding: '1px 6px', fontSize: 10, color: '#ef4444', borderColor: '#ef4444' }}>Revoke</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {result && <div className={'pool-result' + (result.ok ? ' ok' : ' err')}>{result.msg}</div>}

      {isHance && (
        <div className="pool-hance-note">
          The founding community pool. All ecosystem fees are routed here first.
        </div>
      )}
    </div>
  );
}

// ─── Main Pool Page ─────────────────────────────────────────
export default function Pool({ chain, wallet }) {
  const { pools, founder, mainPool, loading, membership, myMetrics, refresh } = usePoolData(wallet.account);
  const { status: directorStatus } = useDirectorAI();
  const [creating, setCreating] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');
  const [createResult, setCreateResult] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const isPoolCreator = (pool) => wallet.account && pool.creator?.toLowerCase() === wallet.account.toLowerCase();

  const handleCreate = async () => {
    if (!newPoolName.trim()) { setCreateResult({ ok: false, msg: 'Enter a pool name' }); return; }
    setCreating(true); setCreateResult(null);
    try {
      const tx = await createPool(newPoolName.trim());
      setCreateResult({ ok: true, msg: `Pool created! TX: ${tx.slice(0, 10)}...` });
      setNewPoolName('');
      setTimeout(() => refresh(), 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setCreateResult({ ok: false, msg: 'Rejected by user' });
      else setCreateResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setCreating(false);
  };

  // Aggregate stats
  const myPoolIds = Object.keys(membership).filter(id => membership[id]);
  const totalDeposited = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.depositedETH || 0), 0);
  const totalClaimable = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.claimable || 0), 0);
  const totalClaimed = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.rewardsClaimed || 0), 0);
  const totalFCReceived = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.fcReceived || 0), 0);
  const totalPoolETH = pools.reduce((sum, p) => sum + p.totalETH, 0);
  const totalMembers = pools.reduce((sum, p) => sum + p.memberCount, 0);
  const totalRewards = pools.reduce((sum, p) => sum + p.rewardsAccrued, 0);

  return (
    <div className="page">
      <h1>Family Pools</h1>
      <p className="page-sub">Pick a pool, deposit ETH, start earning. That's it.</p>

      {/* ─── TASK 1: Uniswap Trading Pool ─── */}
      <div className="section">
        <h2>Uniswap Trading Pool</h2>
        <p className="page-sub" style={{ marginBottom: 12 }}>Where FC is bought and sold. Family Pools below earn rewards from this trading activity.</p>
        <div className="stats-grid stats-grid-4">
          <StatCard label="FC in Pool" value={fmt(chain.poolReserveFC, 2) + ' FC'} sub="Reserve" color="#f59e0b" />
          <StatCard label="ETH in Pool" value={fmt(chain.poolReserveETH, 6) + ' ETH'} sub="Reserve" color="#3b82f6" />
          <StatCard label="Pool Depth" value={'$' + fmt(chain.poolLiquidityUsd, 2)} sub="Total liquidity" color="#10b981" />
          <StatCard label="FC Price" value={'$' + fmt(chain.fcPriceUsd, 6)} sub={fmt(chain.fcPrice, 10) + ' ETH'} color="#00ffcc" />
        </div>
      </div>

      {/* ─── TASK 2: Your Total Position ─── */}
      {wallet.account && (
        <div className="section">
          <h2>Your Total Position</h2>
          <div className="stats-grid stats-grid-4">
            <StatCard
              label="ETH in Pools"
              value={fmt(totalDeposited, 6) + ' ETH'}
              sub={'$' + fmt(totalDeposited * chain.ethPrice, 2)}
              color="#3b82f6"
            />
            <StatCard
              label="FC in Wallet"
              value={fmt(chain.walletFC, 2) + ' FC'}
              sub={'$' + fmt(chain.walletFC * chain.fcPriceUsd, 2)}
              color="#f59e0b"
            />
            <StatCard
              label="Claimable Rewards"
              value={fmt(totalClaimable, 4) + ' FC'}
              sub={'$' + fmt(totalClaimable * chain.fcPriceUsd, 4)}
              color="#10b981"
            />
            <StatCard
              label="Total USD Value"
              value={'$' + fmt(
                (totalDeposited * chain.ethPrice) +
                (chain.walletFC * chain.fcPriceUsd) +
                (totalClaimable * chain.fcPriceUsd), 2
              )}
              sub="Pools + Wallet + Rewards"
              color="#7c3aed"
            />
          </div>
          {chain.walletFC > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              LP token share not included yet. If you hold Uniswap LP tokens, your position is larger.
            </p>
          )}
        </div>
      )}

      {/* Your Portfolio */}
      {myPoolIds.length > 0 && (
        <div className="section">
          <h2>Your Portfolio</h2>
          <div className="stats-grid stats-grid-4">
            <StatCard label="Your Pools" value={myPoolIds.length} sub={`of ${pools.length} total`} color="#7c3aed" />
            <StatCard label="Total Deposited" value={fmt(totalDeposited, 6) + ' ETH'} sub="Across all pools" color="#3b82f6" />
            <StatCard label="FC Received" value={fmt(totalFCReceived, 2) + ' FC'} sub="From deposits" color="#f59e0b" />
            <StatCard label="Claimable Rewards" value={fmt(totalClaimable, 4) + ' FC'} sub={totalClaimed > 0 ? `${fmt(totalClaimed, 2)} already claimed` : 'Accruing from trades'} color="#10b981" />
          </div>
        </div>
      )}

      {/* Ecosystem Overview */}
      <div className="section">
        <h2>Ecosystem</h2>
        <div className="stats-grid stats-grid-3">
          <StatCard label="Total Pools" value={pools.length} sub={`${totalMembers} members`} color="#00ffcc" />
          <StatCard label="Total ETH" value={fmt(totalPoolETH, 6) + ' ETH'} sub="All pools" color="#3b82f6" />
          <StatCard label="Total Rewards" value={fmt(totalRewards, 2) + ' FC'} sub="Distributed" color="#10b981" />
        </div>
      </div>

      {/* Growth Tracker */}
      <div className="section">
        <h2>Growth Tracker</h2>
        <ProgressBar poolLiquidityUsd={chain.poolLiquidityUsd} />
      </div>

      {/* All Pools */}
      <div className="section">
        <div className="pools-header">
          <h2>Pools ({pools.length})</h2>
          {wallet.account && wallet.isBase && (
            <button onClick={() => setShowCreate(!showCreate)} className="btn btn-outline">
              {showCreate ? 'Cancel' : '+ Create Pool'}
            </button>
          )}
        </div>

        {showCreate && wallet.account && wallet.isBase && (
          <div className="create-pool-form">
            <h3>Create a New Pool</h3>
            <div className="pool-join-row">
              <input type="text" placeholder="Pool name" value={newPoolName} onChange={e => setNewPoolName(e.target.value)} className="pool-input" maxLength={50} />
              <button onClick={handleCreate} disabled={creating} className="btn btn-primary">{creating ? 'Creating...' : 'Create'}</button>
            </div>
            <div className="pool-join-note">Costs only gas (under $0.01). Anyone can join once created.</div>
            {createResult && <div className={'pool-result' + (createResult.ok ? ' ok' : ' err')}>{createResult.msg}</div>}
          </div>
        )}

        {!wallet.account && (
          <div className="connect-prompt">
            <p>Connect your wallet to join or create pools</p>
            <button onClick={wallet.connect} className="btn btn-primary">Connect Wallet</button>
          </div>
        )}

        {wallet.account && !wallet.isBase && (
          <div className="connect-prompt">
            <p>Switch to Base to interact with pools</p>
            <button onClick={wallet.switchToBase} className="btn btn-warning">Switch to Base</button>
          </div>
        )}

        {loading ? (
          <div className="loading-state">Loading pools...</div>
        ) : pools.length === 0 ? (
          <div className="loading-state">No pools yet.</div>
        ) : (
          <div className="pools-list">
            {pools.map(pool => (
              <PoolCard key={pool.id} pool={pool} isMember={membership[pool.id] || false} wallet={wallet} isCreator={isPoolCreator(pool)} myMetrics={myMetrics[pool.id]} onRefresh={refresh} />
            ))}
          </div>
        )}
      </div>

      {/* How It Works — 3 steps, not 14 */}
      <div className="section">
        <h2>How It Works</h2>
        <div className="steps">
          <div className="step"><div className="step-num">1</div><div><strong>Connect your wallet</strong><p>MetaMask, Coinbase, or any wallet on Base.</p></div></div>
          <div className="step"><div className="step-num">2</div><div><strong>Pick a pool and deposit</strong><p>Enter your ETH amount and confirm. One transaction.</p></div></div>
          <div className="step"><div className="step-num">3</div><div><strong>Earn and claim</strong><p>The Director AI trades 24/7. Claim your FC rewards anytime.</p></div></div>
        </div>
      </div>

      {/* ─── TASK 4: Reward Activity ─── */}
      <div className="section">
        <h2>Reward Activity</h2>
        <div style={{ padding: '12px 16px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <p style={{ margin: '0 0 8px' }}>Rewards are funded by the Director AI's trading profits. Every 10 successful trades, the Director distributes 5% of net profit as FC to Pool #0 (Founder Pool).</p>
          {directorStatus?.distributionLog?.length > 0 ? (
            <p style={{ margin: '0 0 6px', color: '#10b981', fontWeight: 500 }}>
              Last distribution: {fmt(directorStatus.distributionLog[0]?.fcAmount, 2)} FC to Pool #0
              {directorStatus.distributionLog[0]?.time
                ? ` (${timeAgo(Math.floor(directorStatus.distributionLog[0].time / 1000))})`
                : ''}
            </p>
          ) : (
            <p style={{ margin: '0 0 6px', color: 'var(--text-dim)' }}>No distributions yet -- the Director will distribute after its next 10 trades.</p>
          )}
          {directorStatus?.totalSwapCount > 0 && (
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)' }}>
              Director: {directorStatus.totalSwapCount} trades completed | {directorStatus.tradesSinceLastDistribution || 0}/10 until next distribution
            </p>
          )}
        </div>
      </div>

      {/* Verify */}
      <div className="section">
        <h2>Verify On-Chain</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href={BASESCAN_POOLS} target="_blank" rel="noreferrer" className="btn btn-outline">Pools Contract</a>
          <a href={BASESCAN_TOKEN} target="_blank" rel="noreferrer" className="btn btn-outline">FC Token</a>
        </div>
      </div>
    </div>
  );
}
