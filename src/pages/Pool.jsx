import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import StatCard from '../components/StatCard';
import ProgressBar from '../components/ProgressBar';
import { BASESCAN_POOLS, BASESCAN_TOKEN, FC_POOLS, FC_TOKEN, TIERS } from '../config';
import { usePoolData, joinPoolETH, createPool, inviteToPool, claimRewards, checkInvited, depositETH, checkFNCAllowance, approveFNC, depositFNC, setFamilySplitBps, getFamilySplitBps } from '../hooks/usePoolData';

// ─── Join request storage (localStorage — no backend needed) ───
const REQ_KEY = 'fc_pool_join_requests';

function getRequests() {
  try { return JSON.parse(localStorage.getItem(REQ_KEY) || '{}'); } catch { return {}; }
}

function saveRequest(poolId, walletAddress) {
  const reqs = getRequests();
  if (!reqs[poolId]) reqs[poolId] = [];
  const lower = walletAddress.toLowerCase();
  if (!reqs[poolId].find(r => r.addr.toLowerCase() === lower)) {
    reqs[poolId].push({ addr: walletAddress, time: Date.now() });
    localStorage.setItem(REQ_KEY, JSON.stringify(reqs));
  }
}

function removeRequest(poolId, walletAddress) {
  const reqs = getRequests();
  if (reqs[poolId]) {
    reqs[poolId] = reqs[poolId].filter(r => r.addr.toLowerCase() !== walletAddress.toLowerCase());
    localStorage.setItem(REQ_KEY, JSON.stringify(reqs));
  }
}

function getPoolRequests(poolId) {
  return (getRequests()[poolId] || []);
}

// ─── Helpers ───────────────────────────────────────────────────
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

// ─── Pool Card with Metrics ────────────────────────────────────
function PoolCard({ pool, isMember, wallet, isCreator, isInvited, myMetrics, onRefresh }) {
  const [amount, setAmount] = useState('');
  const [joining, setJoining] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmt, setDepositAmt] = useState('');
  const [depositType, setDepositType] = useState('eth');
  const [result, setResult] = useState(null);
  const [showManage, setShowManage] = useState(false);
  const [inviteAddr, setInviteAddr] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [requested, setRequested] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [fncApproved, setFncApproved] = useState(true); // default true — approve inline if needed
  const [approving, setApproving] = useState(false);
  const isHance = pool.id === 0;

  useEffect(() => {
    if (isCreator) setPendingRequests(getPoolRequests(pool.id));
  }, [isCreator, pool.id, showManage]);

  // Check FNC allowance via MetaMask (not public RPC) to avoid rate limits
  useEffect(() => {
    if (showDeposit && depositType === 'fnc' && wallet.account) {
      checkFNCAllowance().then(allowance => {
        if (allowance > 0) setFncApproved(true);
        // On failure, keep fncApproved=true (default) — if not actually approved,
        // the deposit will fail with a clear error and user can approve then
      }).catch(() => {});
    }
  }, [showDeposit, depositType, wallet.account]);

  const handleJoin = async () => {
    const eth = parseFloat(amount);
    if (!eth || eth <= 0) { setResult({ ok: false, msg: 'Enter an ETH amount' }); return; }
    setJoining(true); setResult(null);
    try {
      const tx = await joinPoolETH(pool.id, eth);
      setResult({ ok: true, msg: `Joined! TX: ${tx.slice(0, 10)}...` });
      setAmount('');
      setTimeout(() => onRefresh?.(), 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
      else if (msg.includes('not invited')) setResult({ ok: false, msg: 'You haven\'t been approved yet. The pool creator needs to approve your request first.' });
      else setResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setJoining(false);
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

  const handleApproveFNC = async () => {
    setApproving(true); setResult(null);
    try {
      setResult({ ok: true, msg: 'Step 1: Confirm the approval in MetaMask...' });
      await approveFNC();
      setFncApproved(true);
      setResult({ ok: true, msg: 'FNC approved! Now enter your amount and hit Deposit.' });
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Approval rejected by user' });
      else setResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setApproving(false);
  };

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmt);
    if (!amt || amt <= 0) { setResult({ ok: false, msg: `Enter a ${depositType.toUpperCase()} amount` }); return; }
    setDepositing(true); setResult(null);
    try {
      let tx;
      if (depositType === 'eth') {
        tx = await depositETH(pool.id, amt);
      } else {
        // Try deposit — if it fails due to allowance, auto-approve then retry
        try {
          tx = await depositFNC(pool.id, amt);
        } catch (depositErr) {
          const dMsg = depositErr.message || '';
          if (dMsg.includes('allowance') || dMsg.includes('exceeds') || dMsg.includes('insufficient')) {
            setResult({ ok: true, msg: 'Approving FNC first... confirm in MetaMask' });
            await approveFNC();
            setResult({ ok: true, msg: 'Approved! Now depositing... confirm again in MetaMask' });
            tx = await depositFNC(pool.id, amt);
          } else {
            throw depositErr;
          }
        }
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

  const [requestLink, setRequestLink] = useState(null);

  const handleRequestJoin = () => {
    // Generate a link the requester can send to the pool creator
    const link = `${window.location.origin}${window.location.pathname}#/pool?join=${pool.id}&approve=${wallet.account}`;
    setRequestLink(link);
    setRequested(true);
    // Also save locally as backup
    saveRequest(pool.id, wallet.account);
  };

  const handleCopyRequestLink = () => {
    if (requestLink) {
      navigator.clipboard.writeText(requestLink);
      setResult({ ok: true, msg: 'Link copied! Send it to the pool creator to get approved.' });
    }
  };

  const handleCopyInviteLink = () => {
    const link = `${window.location.origin}${window.location.pathname}#/pool?join=${pool.id}`;
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleApproveRequest = async (addr) => {
    setInviting(true); setInviteResult(null);
    try {
      const tx = await inviteToPool(pool.id, addr);
      setInviteResult({ ok: true, msg: `Approved ${addr.slice(0, 6)}...! TX: ${tx.slice(0, 10)}...` });
      removeRequest(pool.id, addr);
      setPendingRequests(getPoolRequests(pool.id));
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setInviteResult({ ok: false, msg: 'Rejected by user' });
      else setInviteResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setInviting(false);
  };

  const handleManualInvite = async () => {
    const addr = inviteAddr.trim();
    if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
      setInviteResult({ ok: false, msg: 'Enter a valid wallet address (0x...)' }); return;
    }
    setInviting(true); setInviteResult(null);
    try {
      const tx = await inviteToPool(pool.id, addr);
      setInviteResult({ ok: true, msg: `Invited! TX: ${tx.slice(0, 10)}...` });
      setInviteAddr('');
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setInviteResult({ ok: false, msg: 'Rejected by user' });
      else setInviteResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setInviting(false);
  };

  const showRequestButton = wallet.account && wallet.isBase && !isMember && !isCreator && !isInvited && pool.isActive && !pool.isFull;
  const showDepositForm = wallet.account && wallet.isBase && !isMember && !isCreator && isInvited && pool.isActive && !pool.isFull;
  const m = myMetrics; // shorthand

  return (
    <div className={'pool-card' + (isHance ? ' pool-featured' : '')}>
      {isHance && <div className="pool-badge">Founder Pool</div>}
      <div className="pool-card-header">
        <h3>{pool.name || `Pool #${pool.id}`}</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pool-id-tag">ID: {pool.id}</span>
          <span className={'pool-status' + (pool.isActive ? ' active' : '')}>{pool.isActive ? 'Active' : 'Pending'}</span>
          {isCreator && <span className="pool-creator-tag">Your Pool</span>}
        </div>
      </div>

      {/* ── Group Pool Metrics ── */}
      <div className="pool-metrics-section">
        <h4 className="pool-metrics-title">Pool Stats</h4>
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
            <span className="pool-stat-label">Total FNC</span>
            <span className="pool-stat-value">{fmt(pool.totalFNC, 2)}</span>
          </div>
          <div className="pool-stat">
            <span className="pool-stat-label">FC Minted</span>
            <span className="pool-stat-value">{fmt(pool.totalFCMinted, 2)}</span>
          </div>
          <div className="pool-stat">
            <span className="pool-stat-label">Rewards Pool</span>
            <span className="pool-stat-value highlight">{fmt(pool.rewardsAccrued, 2)} <span className="pool-stat-unit">FC</span></span>
          </div>
          <div className="pool-stat">
            <span className="pool-stat-label">Created</span>
            <span className="pool-stat-value">{pool.createdAt > 0 ? new Date(pool.createdAt * 1000).toLocaleDateString() : '—'}</span>
          </div>
        </div>
        {/* Pool capacity bar */}
        <div className="pool-capacity">
          <div className="pool-capacity-bar">
            <div className="pool-capacity-fill" style={{ width: `${(pool.memberCount / 10) * 100}%` }} />
          </div>
          <span className="pool-capacity-label">{pool.memberCount}/10 members</span>
        </div>
      </div>

      {/* ── Personal Metrics (if member) ── */}
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
                <span className="pool-stat-label">Your FNC</span>
                <span className="pool-stat-value">{fmt(m.depositedFNC, 2)}</span>
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
              <div className="pool-stat">
                <span className="pool-stat-label">Joined</span>
                <span className="pool-stat-value">{m.joinedAt > 0 ? timeAgo(m.joinedAt) : '—'}</span>
              </div>
            </div>
          )}

          {/* Claimable rewards */}
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

          {/* Deposit more — always visible for members */}
          <div className="pool-deposit-section">
            <button onClick={() => setShowDeposit(!showDeposit)} className="btn btn-primary btn-sm">
              {showDeposit ? 'Hide Deposit' : 'Add Funds to Pool'}
            </button>
            {showDeposit && (
              <div style={{ marginTop: 10 }}>
                <div className="pool-deposit-toggle">
                  <button onClick={() => setDepositType('eth')} className={'btn btn-sm ' + (depositType === 'eth' ? 'btn-primary' : 'btn-outline')}>ETH</button>
                  <button onClick={() => setDepositType('fnc')} className={'btn btn-sm ' + (depositType === 'fnc' ? 'btn-primary' : 'btn-outline')}>FNC</button>
                </div>
                {depositType === 'fnc' && !fncApproved && (
                  <div style={{ marginTop: 8 }}>
                    <div className="pool-join-note" style={{ marginBottom: 8, color: '#f59e0b' }}>
                      Step 1: You need to approve FNC spending first. This is a one-time approval.
                    </div>
                    <button onClick={handleApproveFNC} disabled={approving} className="btn btn-primary" style={{ width: '100%' }}>
                      {approving ? 'Approving in MetaMask...' : 'Approve FNC (one-time)'}
                    </button>
                  </div>
                )}
                {(depositType === 'eth' || fncApproved) && (
                  <div className="pool-join-row" style={{ marginTop: 8 }}>
                    <input type="number" step={depositType === 'eth' ? '0.001' : '1'} min="0" placeholder={`${depositType.toUpperCase()} amount`} value={depositAmt} onChange={e => setDepositAmt(e.target.value)} className="pool-input" />
                    <button onClick={handleDeposit} disabled={depositing} className="btn btn-primary">{depositing ? 'Depositing...' : 'Deposit'}</button>
                  </div>
                )}
                <div className="pool-join-note">5% ecosystem fee applies. Grows your pool share and earns you more FC.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Already a member badge ── */}
      {wallet.account && wallet.isBase && isMember && (
        <div className="pool-join">
          <div className="pool-member-badge">You're a member</div>
        </div>
      )}

      {/* ── Pool full ── */}
      {wallet.account && wallet.isBase && !isMember && pool.isFull && (
        <div className="pool-join"><div className="pool-full-badge">Pool is full</div></div>
      )}

      {/* ── Not active ── */}
      {wallet.account && wallet.isBase && !isMember && !pool.isFull && !pool.isActive && (
        <div className="pool-join"><div className="pool-pending-badge">Pool not yet active</div></div>
      )}

      {/* ── Request to Join — not invited yet ── */}
      {showRequestButton && (
        <div className="pool-join">
          {requested ? (
            <div>
              <div className="pool-request-sent">Send this link to the pool creator so they can approve you:</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <input type="text" value={requestLink || ''} readOnly className="pool-input" style={{ fontSize: 11 }} onClick={e => e.target.select()} />
                <button onClick={handleCopyRequestLink} className="btn btn-primary btn-sm">Copy</button>
              </div>
              <div className="pool-join-note" style={{ marginTop: 6 }}>Text, DM, or email this link. When they open it, your wallet is auto-filled for approval. No gas needed for this step.</div>
            </div>
          ) : (
            <>
              <button onClick={handleRequestJoin} className="btn btn-primary">Request to Join</button>
              <div className="pool-join-note">Generates a link you send to the pool creator. No gas required.</div>
            </>
          )}
        </div>
      )}

      {/* ── Deposit form — invited but not yet joined ── */}
      {showDepositForm && (
        <div className="pool-join">
          <div className="pool-approved-badge">You're approved! Deposit ETH to join.</div>
          <div className="pool-join-row">
            <input type="number" step="0.001" min="0" placeholder="ETH amount to deposit" value={amount} onChange={e => setAmount(e.target.value)} className="pool-input" />
            <button onClick={handleJoin} disabled={joining} className="btn btn-primary">{joining ? 'Joining...' : 'Join Pool'}</button>
          </div>
          <div className="pool-join-note">5% ecosystem fee applies. Gas on Base is under $0.01.</div>
        </div>
      )}

      {/* Result messages */}
      {result && <div className={'pool-result' + (result.ok ? ' ok' : ' err')}>{result.msg}</div>}

      {/* ── Creator tools ── */}
      {isCreator && wallet.account && wallet.isBase && (
        <div className="pool-invite-section">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleCopyInviteLink} className="btn btn-primary btn-sm">
              {linkCopied ? 'Link Copied!' : 'Copy Invite Link'}
            </button>
            <button onClick={() => setShowManage(!showManage)} className="btn btn-outline btn-sm">
              {showManage ? 'Hide' : `Manage${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}`}
            </button>
          </div>

          {showManage && (
            <div className="pool-manage-section">
              {pendingRequests.length > 0 && (
                <div className="pool-requests">
                  <h4>Pending Requests</h4>
                  {pendingRequests.map(req => (
                    <div key={req.addr} className="pool-request-row">
                      <span className="pool-request-addr">{req.addr.slice(0, 6)}...{req.addr.slice(-4)}</span>
                      <span className="pool-request-time">{new Date(req.time).toLocaleDateString()}</span>
                      <button onClick={() => handleApproveRequest(req.addr)} disabled={inviting} className="btn btn-primary btn-sm">{inviting ? '...' : 'Approve'}</button>
                      <button onClick={() => { removeRequest(pool.id, req.addr); setPendingRequests(getPoolRequests(pool.id)); }} className="btn btn-outline btn-sm">Dismiss</button>
                    </div>
                  ))}
                </div>
              )}
              {pendingRequests.length === 0 && (
                <p className="pool-join-note" style={{ marginTop: 8 }}>No pending requests. Share your invite link to get started.</p>
              )}
              <div style={{ marginTop: 12 }}>
                <h4>Invite by Address</h4>
                <div className="pool-join-row">
                  <input type="text" placeholder="Wallet address (0x...)" value={inviteAddr} onChange={e => setInviteAddr(e.target.value)} className="pool-input" maxLength={42} />
                  <button onClick={handleManualInvite} disabled={inviting} className="btn btn-primary">{inviting ? '...' : 'Invite'}</button>
                </div>
              </div>
              {inviteResult && <div className={'pool-result' + (inviteResult.ok ? ' ok' : ' err')} style={{ marginTop: 8 }}>{inviteResult.msg}</div>}
            </div>
          )}
        </div>
      )}

      {isHance && (
        <div className="pool-hance-note">
          The founding community pool. All ecosystem fees are routed here first to build the foundation before expanding.
        </div>
      )}
    </div>
  );
}

// ─── Fee Fix Banner (owner only) ─────────────────────────────
function FeeSplitFixer({ wallet, onFixed }) {
  const [splitBps, setSplitBps] = useState(null);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);

  useEffect(() => {
    getFamilySplitBps().then(v => { if (v !== null) setSplitBps(v); }).catch(() => {});
  }, []);

  if (splitBps === null || splitBps === 9500) return null;

  const handleFix = async () => {
    setFixing(true); setFixResult(null);
    try {
      const tx = await setFamilySplitBps(9500);
      setFixResult({ ok: true, msg: `Fixed! TX: ${tx.slice(0, 10)}... Family pools now keep 95%. Refresh in a few seconds.` });
      setTimeout(() => { setSplitBps(9500); onFixed?.(); }, 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setFixResult({ ok: false, msg: 'Rejected by user' });
      else if (msg.includes('not owner')) setFixResult({ ok: false, msg: 'Only the contract owner can change this setting.' });
      else setFixResult({ ok: false, msg: msg.slice(0, 120) });
    }
    setFixing(false);
  };

  return (
    <div className="section" style={{ background: '#2a1a0a', border: '1px solid #f59e0b', borderRadius: 12, padding: 16 }}>
      <h2 style={{ color: '#f59e0b', marginTop: 0 }}>Fee Split Needs Fixing</h2>
      <p style={{ color: '#ccc', margin: '8px 0' }}>
        <strong>familySplitBps = {splitBps}</strong> ({(splitBps / 100).toFixed(0)}% to family pools, {(100 - splitBps / 100).toFixed(0)}% to treasury).
        This means {(100 - splitBps / 100).toFixed(0)}% of every deposit (after the 5% founder fee) goes to treasury instead of your pool.
      </p>
      <p style={{ color: '#ccc', margin: '8px 0' }}>
        Fix: Set to <strong>9500</strong> (95% stays in family pool, 5% to treasury). Total effective fee becomes ~9.75%.
      </p>
      <button onClick={handleFix} disabled={fixing} className="btn btn-primary" style={{ marginTop: 8 }}>
        {fixing ? 'Confirm in MetaMask...' : 'Fix Fee Split (One Click)'}
      </button>
      {fixResult && <div className={'pool-result ' + (fixResult.ok ? 'ok' : 'err')} style={{ marginTop: 8 }}>{fixResult.msg}</div>}
    </div>
  );
}

// ─── Main Pool Page ────────────────────────────────────────────
export default function Pool({ chain, wallet }) {
  const [searchParams] = useSearchParams();
  const { pools, founder, mainPool, loading, membership, myMetrics, refresh } = usePoolData(wallet.account);
  const [creating, setCreating] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');
  const [createResult, setCreateResult] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [invitedStatus, setInvitedStatus] = useState({});

  const joinParam = searchParams.get('join');
  const approveParam = searchParams.get('approve');
  const [joinById, setJoinById] = useState(joinParam || '');
  const [autoApproveAddr, setAutoApproveAddr] = useState(approveParam || null);
  const [autoApproveResult, setAutoApproveResult] = useState(null);
  const [autoApproving, setAutoApproving] = useState(false);

  useEffect(() => {
    if (joinParam !== null) setJoinById(joinParam);
    if (approveParam) setAutoApproveAddr(approveParam);
  }, [joinParam, approveParam]);

  useEffect(() => {
    if (!wallet.account || pools.length === 0) return;
    const check = async () => {
      const status = {};
      for (const p of pools) {
        if (!membership[p.id]) {
          status[p.id] = await checkInvited(p.id, wallet.account);
        }
      }
      setInvitedStatus(status);
    };
    check();
  }, [wallet.account, pools, membership]);

  const handleCreate = async () => {
    if (!newPoolName.trim()) { setCreateResult({ ok: false, msg: 'Enter a pool name' }); return; }
    setCreating(true); setCreateResult(null);
    try {
      const tx = await createPool(newPoolName.trim());
      setCreateResult({ ok: true, msg: `Pool created! TX: ${tx.slice(0, 10)}... — Refresh in a few seconds.` });
      setNewPoolName('');
      setTimeout(() => refresh(), 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setCreateResult({ ok: false, msg: 'Rejected by user' });
      else setCreateResult({ ok: false, msg: msg.slice(0, 100) });
    }
    setCreating(false);
  };

  const invitePool = joinById !== '' ? pools.find(p => p.id === parseInt(joinById)) : null;
  const isPoolCreator = (pool) => wallet.account && pool.creator?.toLowerCase() === wallet.account.toLowerCase();

  // Aggregate personal stats across all pools
  const myPoolIds = Object.keys(membership).filter(id => membership[id]);
  const totalDeposited = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.depositedETH || 0), 0);
  const totalClaimable = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.claimable || 0), 0);
  const totalClaimed = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.rewardsClaimed || 0), 0);
  const totalFCReceived = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.fcReceived || 0), 0);

  // Aggregate group stats across all pools
  const totalPoolETH = pools.reduce((sum, p) => sum + p.totalETH, 0);
  const totalPoolFNC = pools.reduce((sum, p) => sum + p.totalFNC, 0);
  const totalMembers = pools.reduce((sum, p) => sum + p.memberCount, 0);
  const totalRewards = pools.reduce((sum, p) => sum + p.rewardsAccrued, 0);

  return (
    <div className="page">
      <h1>Family Pools</h1>
      <p className="page-sub">Invite-only investment pools on Base. Join a pool you've been invited to, or create your own and invite members.</p>

      {/* ── Fee Fix Banner (owner only) ── */}
      {wallet.account && wallet.isBase && (
        <FeeSplitFixer wallet={wallet} onFixed={refresh} />
      )}

      {/* ── Approve Request Banner (when opened via approval link) ── */}
      {autoApproveAddr && joinById && wallet.account && wallet.isBase && (
        <div className="section" style={{ background: '#0a2a1a', border: '1px solid #10b981', borderRadius: 12, padding: 16 }}>
          <h2 style={{ color: '#10b981', marginTop: 0 }}>Approve Join Request</h2>
          <p style={{ color: '#ccc' }}>
            <strong>{autoApproveAddr.slice(0, 6)}...{autoApproveAddr.slice(-4)}</strong> wants to join Pool #{joinById}
          </p>
          <button
            onClick={async () => {
              setAutoApproving(true); setAutoApproveResult(null);
              try {
                const tx = await inviteToPool(parseInt(joinById), autoApproveAddr);
                setAutoApproveResult({ ok: true, msg: `Approved! TX: ${tx.slice(0, 10)}... They can now deposit and join.` });
                setAutoApproveAddr(null);
              } catch (err) {
                const msg = err.message || '';
                if (msg.includes('4001') || msg.includes('rejected')) setAutoApproveResult({ ok: false, msg: 'Rejected by user' });
                else setAutoApproveResult({ ok: false, msg: msg.slice(0, 100) });
              }
              setAutoApproving(false);
            }}
            disabled={autoApproving}
            className="btn btn-primary"
          >
            {autoApproving ? 'Confirm in MetaMask...' : 'Approve This Wallet'}
          </button>
          {autoApproveResult && <div className={'pool-result ' + (autoApproveResult.ok ? 'ok' : 'err')} style={{ marginTop: 8 }}>{autoApproveResult.msg}</div>}
        </div>
      )}

      {/* ── Your Portfolio (if member of any pool) ── */}
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

      {/* ── Ecosystem Overview ── */}
      <div className="section">
        <h2>Ecosystem Overview</h2>
        <div className="stats-grid stats-grid-4">
          <StatCard label="Total Pools" value={pools.length} sub={`${totalMembers} members`} color="#00ffcc" />
          <StatCard label="Total ETH Deposited" value={fmt(totalPoolETH, 6) + ' ETH'} sub="All pools combined" color="#3b82f6" />
          <StatCard label="Total FNC Deposited" value={fmt(totalPoolFNC, 2) + ' FNC'} sub="All pools combined" color="#8b5cf6" />
          <StatCard label="Total Rewards" value={fmt(totalRewards, 2) + ' FC'} sub="Distributed to pools" color="#10b981" />
        </div>
        {founder && (
          <div className="stats-grid stats-grid-3" style={{ marginTop: 12 }}>
            <StatCard
              label="Ecosystem Fee Progress"
              value={fmt(founder.accumulated, 2) + ' FC'}
              sub={founder.thresholdMet ? 'Threshold reached' : `Building to ${fmt(founder.threshold, 0)} FC`}
              color={founder.thresholdMet ? '#10b981' : '#f59e0b'}
            />
            <StatCard label="Treasury ETH" value={fmt(mainPool?.mainPoolETH || 0, 6) + ' ETH'} sub="Community reserve" color="#3b82f6" />
            <StatCard label="Treasury FNC" value={fmt(mainPool?.mainPoolFNC || 0, 2) + ' FNC'} sub="Community reserve" color="#8b5cf6" />
          </div>
        )}
      </div>

      {/* ── Growth Tracker ── */}
      <div className="section">
        <h2>Growth Tracker</h2>
        <ProgressBar poolLiquidityUsd={chain.poolLiquidityUsd} />
      </div>

      {/* ── Join by Invite ── */}
      <div className="section">
        <h2>Join by Invitation</h2>
        <p className="section-sub">Got an invite link? It opens automatically. Or enter a Pool ID below.</p>
        <div className="pool-join-row">
          <input type="number" min="0" placeholder="Enter Pool ID (e.g. 0, 1, 2...)" value={joinById} onChange={e => setJoinById(e.target.value)} className="pool-input" />
        </div>
        {joinById !== '' && invitePool && (
          <div style={{ marginTop: 12 }}>
            <PoolCard pool={invitePool} isMember={membership[invitePool.id] || false} wallet={wallet} isCreator={isPoolCreator(invitePool)} isInvited={invitedStatus[invitePool.id] || false} myMetrics={myMetrics[invitePool.id]} onRefresh={refresh} />
          </div>
        )}
        {joinById !== '' && !invitePool && !loading && (
          <div className="pool-result err" style={{ marginTop: 8 }}>No pool found with ID {joinById}</div>
        )}
      </div>

      {/* ── All Pools ── */}
      <div className="section">
        <div className="pools-header">
          <h2>All Pools ({pools.length})</h2>
          {wallet.account && wallet.isBase && (
            <button onClick={() => setShowCreate(!showCreate)} className="btn btn-outline">
              {showCreate ? 'Cancel' : '+ Create Your Own Pool'}
            </button>
          )}
        </div>

        {showCreate && wallet.account && wallet.isBase && (
          <div className="create-pool-form">
            <h3>Create a New Family Pool</h3>
            <p className="section-sub">You'll be the first member. Share your invite link to get members.</p>
            <div className="pool-join-row">
              <input type="text" placeholder="Pool name (e.g. Smith Family Pool)" value={newPoolName} onChange={e => setNewPoolName(e.target.value)} className="pool-input" maxLength={50} />
              <button onClick={handleCreate} disabled={creating} className="btn btn-primary">{creating ? 'Creating...' : 'Create Pool'}</button>
            </div>
            <div className="pool-join-note">Costs only gas (under $0.01 on Base). After creating, use "Copy Invite Link" to share.</div>
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
            <p>Switch to the Base network to interact with pools</p>
            <button onClick={wallet.switchToBase} className="btn btn-warning">Switch to Base</button>
          </div>
        )}

        {loading ? (
          <div className="loading-state">Loading pools from Base chain...</div>
        ) : pools.length === 0 ? (
          <div className="loading-state">No pools found on-chain yet.</div>
        ) : (
          <div className="pools-list">
            {pools.map(pool => (
              <PoolCard key={pool.id} pool={pool} isMember={membership[pool.id] || false} wallet={wallet} isCreator={isPoolCreator(pool)} isInvited={invitedStatus[pool.id] || false} myMetrics={myMetrics[pool.id]} onRefresh={refresh} />
            ))}
          </div>
        )}
      </div>

      {/* ── How It Works ── */}
      <div className="section">
        <h2>How Pools Work</h2>
        <div className="steps">
          <div className="step"><div className="step-num">1</div><div><strong>Get an invite link</strong><p>A pool creator shares an invite link with you (email, text, DM — any way you like).</p></div></div>
          <div className="step"><div className="step-num">2</div><div><strong>Connect wallet and request access</strong><p>Click the link, connect your MetaMask wallet, and tap "Request to Join". No gas needed.</p></div></div>
          <div className="step"><div className="step-num">3</div><div><strong>Creator approves you</strong><p>The pool creator sees your request and approves it with one click. Then you can deposit ETH.</p></div></div>
          <div className="step"><div className="step-num">4</div><div><strong>Earn and claim rewards</strong><p>The Director AI trades 24/7. Claim your FC rewards anytime from your pool dashboard.</p></div></div>
        </div>
      </div>

      {/* ── Profit Tiers ── */}
      <div className="section">
        <h2>Profit Tiers</h2>
        <p className="section-sub">As the ecosystem grows, the profit share increases for all pool members.</p>
        <div className="tier-table">
          <div className="tier-row tier-header"><span>Tier</span><span>Pool Size</span><span>Your Profit</span><span>Reinvested</span></div>
          {TIERS.map(t => (
            <div key={t.name} className="tier-row" style={{ borderLeftColor: t.color }}>
              <span>{t.icon} {t.name}</span>
              <span>{t.max === Infinity ? '$10M+' : t.max >= 1_000_000 ? '$' + (t.max/1_000_000) + 'M' : t.max >= 1_000 ? '$' + (t.max/1_000) + 'K' : '$' + t.max}</span>
              <span style={{ color: t.color, fontWeight: 700 }}>{t.profit}%</span>
              <span>{t.reinvest}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Verify ── */}
      <div className="section">
        <h2>Verify On-Chain</h2>
        <p className="section-sub">All pool activity is transparent and verifiable. Transactions appear as members join and deposit.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href={BASESCAN_POOLS} target="_blank" rel="noreferrer" className="btn btn-outline">View Pools Contract</a>
          <a href={BASESCAN_TOKEN} target="_blank" rel="noreferrer" className="btn btn-outline">View FC Token</a>
        </div>
      </div>
    </div>
  );
}
