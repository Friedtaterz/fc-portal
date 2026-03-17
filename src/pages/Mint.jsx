import React, { useState, useEffect, useCallback } from 'react';
import { FC_TOKEN } from '../config';

const SEL = {
  mintForMining: '0xc763b8c2',
  minedSupply: '0x6386d2ac',
  miningCap: '0xce28c1bf',
  mintBudgetRemaining: '0x30ff6589',
};

async function rpcCall(data) {
  const res = await fetch('https://mainnet.base.org', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: FC_TOKEN, data }, 'latest'] }),
  });
  const json = await res.json();
  return json.result;
}

const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Mint({ wallet }) {
  const [minedSupply, setMinedSupply] = useState(null);
  const [miningCap, setMiningCap] = useState(null);
  const [budgetRemaining, setBudgetRemaining] = useState(null);
  const [amount, setAmount] = useState('50000');
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [mined, cap, budget] = await Promise.all([
        rpcCall(SEL.minedSupply),
        rpcCall(SEL.miningCap),
        rpcCall(SEL.mintBudgetRemaining),
      ]);
      setMinedSupply(Number(BigInt(mined)) / 1e18);
      setMiningCap(Number(BigInt(cap)) / 1e18);
      setBudgetRemaining(Number(BigInt(budget)) / 1e18);
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleMint = async () => {
    if (!wallet.account || !wallet.isBase) {
      setResult({ ok: false, msg: 'Connect wallet on Base first' });
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setResult({ ok: false, msg: 'Enter an amount' });
      return;
    }

    setMinting(true);
    setResult(null);
    try {
      const amountWei = BigInt(Math.floor(amt)) * BigInt('1000000000000000000');
      const amountHex = amountWei.toString(16).padStart(64, '0');
      const toHex = wallet.account.slice(2).toLowerCase().padStart(64, '0');
      const data = SEL.mintForMining + toHex + amountHex;

      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: wallet.account,
          to: FC_TOKEN,
          data,
          gas: '0x' + (100000).toString(16),
        }],
      });
      setResult({ ok: true, msg: `Minted ${fmt(amt)} FC! TX: ${txHash.slice(0, 14)}...` });
      setAmount('');
      setTimeout(() => refresh(), 5000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected' });
      else if (msg.includes('rate limit') || msg.includes('50K')) setResult({ ok: false, msg: 'Rate limit hit — max 50K FC per 24 hours' });
      else if (msg.includes('not owner')) setResult({ ok: false, msg: 'Only the contract owner can mint' });
      else if (msg.includes('mining cap')) setResult({ ok: false, msg: 'Mining cap reached (10.5M FC)' });
      else setResult({ ok: false, msg: msg.slice(0, 120) });
    }
    setMinting(false);
  };

  const pctMined = miningCap && minedSupply ? (minedSupply / miningCap) * 100 : 0;

  return (
    <div className="page">
      <h1>Mint Mined FC</h1>
      <p className="page-sub">Mint FC from the mining allocation. Rate limited to 50K FC per 24 hours. Owner only.</p>

      <div className="section">
        <h2>Mining Allocation</h2>
        <div className="stats-grid stats-grid-3">
          <div className="stat-card">
            <div className="stat-label">Mined So Far</div>
            <div className="stat-value">{minedSupply !== null ? fmt(minedSupply) : '...'}</div>
            <div className="stat-sub">of {miningCap !== null ? fmt(miningCap) : '...'} FC cap</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Available Now</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{budgetRemaining !== null ? fmt(budgetRemaining) : '...'}</div>
            <div className="stat-sub">24h rate limit (resets rolling)</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Remaining</div>
            <div className="stat-value">{miningCap !== null && minedSupply !== null ? fmt(miningCap - minedSupply) : '...'}</div>
            <div className="stat-sub">{pctMined.toFixed(1)}% mined</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="progress-section" style={{ marginTop: 16 }}>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pctMined}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent2))' }} />
          </div>
          <div className="progress-labels">
            <span>{minedSupply !== null ? fmt(minedSupply) : '0'} FC mined</span>
            <span>{miningCap !== null ? fmt(miningCap) : '10,500,000'} FC cap</span>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Mint</h2>

        {!wallet.account ? (
          <div className="connect-prompt">
            <p>Connect the owner wallet to mint</p>
            <button onClick={wallet.connect} className="btn btn-primary">Connect Wallet</button>
          </div>
        ) : !wallet.isBase ? (
          <div className="connect-prompt">
            <p>Switch to Base</p>
            <button onClick={wallet.switchToBase} className="btn btn-warning">Switch to Base</button>
          </div>
        ) : (
          <div>
            <div className="pool-join-row">
              <input
                type="number"
                step="1"
                min="1"
                max="50000"
                placeholder="FC amount (max 50,000 per 24h)"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="pool-input"
              />
              <button onClick={handleMint} disabled={minting} className="btn btn-primary">
                {minting ? 'Minting...' : 'Mint FC'}
              </button>
            </div>
            <div className="pool-join-note">
              Mints to your wallet ({wallet.shortAddress}). Max 50,000 FC per rolling 24h window.
            </div>
            {result && <div className={'pool-result' + (result.ok ? ' ok' : ' err')} style={{ marginTop: 8 }}>{result.msg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
