import React, { useState } from 'react';
import StatCard from '../components/StatCard';
import { FC_TOKEN, UNISWAP_BUY_URL, UNISWAP_SELL_URL, BASESCAN_TOKEN, TIERS } from '../config';
import { actionAddLiquidity } from '../hooks/useTradingPipeline';
import { useDirectorAI } from '../hooks/useDirectorAI';

const fmt = (n, d = 2) => n?.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) || '0';

// ─── Director AI Dashboard ──────────────────────────────────────
function DirectorPanel({ chain }) {
  const { status, start, stop, resume, setMode } = useDirectorAI();
  if (!status) return null;

  const poolUsd = chain.poolLiquidityUsd || 0;
  const currentTier = TIERS.find(t => poolUsd < t.max) || TIERS[TIERS.length - 1];
  const mode = status.mode || 'suggest';
  const adaptiveLabel = status.adaptiveMode === 'micro' ? 'MICRO' : status.adaptiveMode === 'careful' ? 'CAREFUL' : 'NORMAL';
  const adaptiveColor = status.adaptiveMode === 'micro' ? '#f59e0b' : status.adaptiveMode === 'careful' ? '#3b82f6' : '#10b981';

  return (
    <div className="section">
      <h2>FC Director AI</h2>
      <p className="section-sub">
        {mode === 'suggest'
          ? 'Suggest mode — shows optimal trades without executing. Switch to Auto to trade automatically.'
          : 'Auto mode — executes trades automatically with adaptive safety limits.'}
      </p>

      {/* Goal Progress */}
      {status.goal && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 4 }}>
            <span>Goal: <strong style={{ color: status.goal.allCompleted ? '#10b981' : '#00ffcc' }}>{status.goal.current}</strong></span>
            <span>{status.goal.completed}/{status.goal.total}</span>
          </div>
          <div style={{ background: '#1a1a2e', borderRadius: 6, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${status.goal.pct}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #10b981)', borderRadius: 6, transition: 'width 0.5s' }} />
          </div>
        </div>
      )}

      {/* Defense Alert */}
      {status.defense && status.defense.level !== 'normal' && (
        <div style={{
          background: status.defense.level === 'critical' ? '#2a0a0a' : '#1a1a0a',
          border: `1px solid ${status.defense.level === 'critical' ? '#ef4444' : '#f59e0b'}`,
          borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12,
          color: status.defense.level === 'critical' ? '#ef4444' : '#f59e0b',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Defense: <strong>{status.defense.level.toUpperCase()}</strong> -- {status.defense.recentAnomalies} anomalies in 10min</span>
          <span>{status.defense.sandwichCount} sandwich alerts total</span>
        </div>
      )}

      {/* Mode Selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {['suggest', 'auto'].map(m => (
          <button key={m} onClick={() => {
            if (m === 'auto' && mode !== 'auto') {
              if (!window.confirm('Enable Auto mode? The Director AI will execute trades automatically using your wallet.')) return;
            }
            setMode(m);
          }} className={mode === m ? 'btn btn-primary' : 'btn btn-outline'}
            style={{ flex: 1, textTransform: 'uppercase', fontSize: 13, fontWeight: 700 }}>
            {m === 'suggest' ? 'Suggest Trades' : 'Auto Trade'}
          </button>
        ))}
      </div>

      {/* Adaptive Mode Indicator */}
      {status.running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: '#111', borderRadius: 8, borderLeft: `3px solid ${adaptiveColor}` }}>
          <span style={{ color: adaptiveColor, fontWeight: 700, fontSize: 13 }}>{adaptiveLabel}</span>
          <span style={{ color: '#888', fontSize: 12 }}>Max {status.maxImpact}% impact per trade | Pool ${fmt(poolUsd)}</span>
        </div>
      )}

      {/* Trinity State (past / present / future) */}
      {status.trinity && status.trinity.whatIs && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 12, fontSize: 11 }}>
          <div style={{ background: '#111', borderRadius: 6, padding: '8px 10px', borderTop: '2px solid #666' }}>
            <div style={{ color: '#888', fontWeight: 700, marginBottom: 4 }}>WAS</div>
            {status.trinity.whatWas ? (<>
              <div style={{ color: '#aaa' }}>${fmt(status.trinity.whatWas.poolUsd, 0)} pool</div>
              <div style={{ color: '#aaa' }}>{status.trinity.whatWas.priceUsd < 0.01 ? status.trinity.whatWas.priceUsd.toFixed(6) : fmt(status.trinity.whatWas.priceUsd, 4)} $/FC</div>
            </>) : <div style={{ color: '#555' }}>No prior cycle</div>}
          </div>
          <div style={{ background: '#0a1a1a', borderRadius: 6, padding: '8px 10px', borderTop: '2px solid #10b981' }}>
            <div style={{ color: '#10b981', fontWeight: 700, marginBottom: 4 }}>IS</div>
            <div style={{ color: '#ccc' }}>${fmt(status.trinity.whatIs.poolUsd, 0)} pool</div>
            <div style={{ color: '#ccc' }}>{status.trinity.whatIs.priceUsd < 0.01 ? status.trinity.whatIs.priceUsd.toFixed(6) : fmt(status.trinity.whatIs.priceUsd, 4)} $/FC</div>
            <div style={{ color: '#888' }}>{status.trinity.whatIs.tier}</div>
          </div>
          <div style={{ background: '#111', borderRadius: 6, padding: '8px 10px', borderTop: '2px solid #3b82f6' }}>
            <div style={{ color: '#3b82f6', fontWeight: 700, marginBottom: 4 }}>WILL BE</div>
            {status.trinity.whatWillBe ? (<>
              <div style={{ color: '#aaa' }}>{status.trinity.whatWillBe.nextAction}</div>
              <div style={{ color: '#aaa' }}>Confidence: {status.trinity.whatWillBe.confidence}%</div>
              <div style={{ color: status.trinity.whatWillBe.trend === 'growing' ? '#10b981' : status.trinity.whatWillBe.trend === 'contracting' ? '#ef4444' : '#888' }}>
                {status.trinity.whatWillBe.trend}
              </div>
            </>) : <div style={{ color: '#555' }}>Projecting...</div>}
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {!status.running ? (
          <button onClick={start} className="btn btn-primary">Start Director</button>
        ) : (
          <button onClick={stop} className="btn btn-outline" style={{ borderColor: '#ef4444', color: '#ef4444' }}>Stop Director</button>
        )}
        {status.paused && (
          <button onClick={resume} className="btn btn-primary">Resume</button>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: status.running ? (status.paused ? '#f59e0b' : '#10b981') : '#666', fontSize: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.running ? (status.paused ? '#f59e0b' : '#10b981') : '#666', display: 'inline-block' }} />
          {status.running ? (status.paused ? 'Paused' : mode === 'suggest' ? 'Watching' : 'Trading') : 'Stopped'}
        </span>
      </div>

      {/* Suggestion Panel (suggest mode) */}
      {mode === 'suggest' && status.suggestion && (
        <div style={{ background: '#0a1a0a', border: '1px solid #10b981', borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ color: '#10b981', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Suggested Trade</div>
          <div style={{ color: '#ccc', fontSize: 13 }}>{status.suggestion.reason}</div>
          {status.suggestion.trendAdvice && (
            <div style={{
              marginTop: 6, padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: status.suggestion.trend === 'growing' || status.suggestion.trend === 'price_rising' || status.suggestion.trend === 'liquidity_inflow' ? '#0a2a1a'
                : status.suggestion.trend === 'contracting' || status.suggestion.trend === 'price_falling' || status.suggestion.trend === 'liquidity_outflow' ? '#2a0a0a'
                : '#1a1a2e',
              color: status.suggestion.trend === 'growing' || status.suggestion.trend === 'price_rising' || status.suggestion.trend === 'liquidity_inflow' ? '#10b981'
                : status.suggestion.trend === 'contracting' || status.suggestion.trend === 'price_falling' || status.suggestion.trend === 'liquidity_outflow' ? '#ef4444'
                : '#888',
              borderLeft: `3px solid ${
                status.suggestion.trend === 'growing' || status.suggestion.trend === 'price_rising' || status.suggestion.trend === 'liquidity_inflow' ? '#10b981'
                : status.suggestion.trend === 'contracting' || status.suggestion.trend === 'price_falling' || status.suggestion.trend === 'liquidity_outflow' ? '#ef4444'
                : '#555'
              }`,
            }}>
              {status.suggestion.trendAdvice} | Confidence: {status.suggestion.confidence}%
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: '#888' }}>
            <span>Tier: {status.suggestion.tier}</span>
            <span>Mode: {status.suggestion.adaptiveMode}</span>
            <span>Gas profit: {fmt(status.suggestion.gasProfit, 8)} ETH</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <a href={`https://app.uniswap.org/swap?inputCurrency=${FC_TOKEN}&chain=base`} target="_blank" rel="noreferrer"
              className="btn btn-primary" style={{ fontSize: 12 }}>
              Trade Manually on Uniswap
            </a>
            <button onClick={() => {
              if (!window.confirm('Enable Auto mode? The Director AI will execute trades automatically using your wallet.')) return;
              setMode('auto');
            }} className="btn btn-outline" style={{ fontSize: 12 }}>
              Enable Auto Mode
            </button>
          </div>
        </div>
      )}

      {/* Blocker / Status — with actionable fix buttons */}
      {status.blocker && (
        <div style={{ background: '#1a1a2e', border: '1px solid #f59e0b', borderRadius: 8, padding: 12, marginBottom: 12, color: '#f59e0b', fontSize: 13 }}>
          <strong>Waiting:</strong> {status.blocker}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {/[Ww]allet|[Cc]onnect/.test(status.blocker) && (
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={async () => {
                try { await window.ethereum?.request({ method: 'eth_requestAccounts' }); } catch {}
              }}>Connect Wallet</button>
            )}
            {/[Bb]ase|[Cc]hain|[Ss]witch/.test(status.blocker) && (
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={async () => {
                try { await window.ethereum?.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); } catch {}
              }}>Switch to Base</button>
            )}
            {/[Gg]as|ETH/.test(status.blocker) && (
              <a href="https://www.coinbase.com/price/ethereum" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }}>Get ETH on Coinbase</a>
            )}
            {/[Pp]air|[Pp]ool|liquidity/.test(status.blocker) && (
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => window.scrollTo({ top: document.querySelector('.section')?.offsetTop || 0, behavior: 'smooth' })}>Add Liquidity Below</button>
            )}
          </div>
        </div>
      )}
      {status.pauseReason && (
        <div style={{ background: '#1a1a2e', border: '1px solid #ef4444', borderRadius: 8, padding: 12, marginBottom: 12, color: '#ef4444', fontSize: 13 }}>
          <strong>Paused:</strong> {status.pauseReason}
        </div>
      )}

      {/* Current Tier */}
      <div style={{ background: '#111', borderRadius: 8, padding: 12, marginBottom: 12, borderLeft: `3px solid ${currentTier.color}` }}>
        <div style={{ color: currentTier.color, fontWeight: 700, fontSize: 14 }}>{currentTier.icon} {currentTier.name}</div>
        <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
          Pool: ${fmt(poolUsd)} | Profit: {currentTier.profit}% | Reinvest: {currentTier.reinvest}%
          {currentTier.reinvest === 0 && ' | All earnings kept as profit'}
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid stats-grid-4">
        <StatCard label="Trades" value={status.totalSwapCount || 0} sub={`${status.cycleCount} cycles`} color="#3b82f6" />
        <StatCard label="FC Sold" value={fmt(status.totalFcSold, 2)} sub="Total swapped" color="#00ffcc" />
        <StatCard label="ETH Earned" value={fmt(status.totalEthEarned, 6)} sub={'$' + fmt(status.totalUsdEarned)} color="#f59e0b" />
        <StatCard
          label="Net Profit"
          value={fmt(status.netProfitEth || 0, 6)}
          sub={'$' + fmt(status.netProfitUsd || 0) + ' (after gas)'}
          color={(status.netProfitEth || 0) >= 0 ? '#10b981' : '#ef4444'}
        />
      </div>

      {/* Gas P&L breakdown */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: '#888' }}>
        <span>Gas spent: {fmt(status.totalGasSpent || 0, 8)} ETH (${fmt(status.totalGasSpentUsd || 0)})</span>
        <span>Avg gas/trade: {status.totalSwapCount > 0 ? fmt((status.totalGasSpent || 0) / status.totalSwapCount, 8) : '—'} ETH</span>
      </div>

      {/* Scaling Info */}
      {status.running && status.swapAmount > 0 && (
        <div style={{ background: '#111', borderRadius: 8, padding: 12, marginTop: 12, fontSize: 13, color: '#aaa' }}>
          <strong style={{ color: '#ccc' }}>Next Trade:</strong> {fmt(status.swapAmount, 2)} FC
          {' → '}{fmt(status.swapEthOut, 8)} ETH
          {' | Impact: '}{status.swapImpact.toFixed(2)}%
          {' | Pool drain: '}{status.swapDrainPct.toFixed(2)}%
        </div>
      )}

      {/* Gas Runway */}
      {status.gasWarning && (
        <div style={{ background: '#1a1a0a', border: '1px solid #f59e0b', borderRadius: 8, padding: 10, marginTop: 12, color: '#f59e0b', fontSize: 12 }}>
          {status.gasWarning}
        </div>
      )}

      {/* Safety Config */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, fontSize: 12, color: '#666' }}>
        <span>Gas runway: ~{status.gasRunwayTxs || '?'} txs</span>
        <span>Max drain: {status.maxDrainPct}%/trade</span>
        <span style={{ color: adaptiveColor }}>Max impact: {status.maxImpact}% ({adaptiveLabel})</span>
        <span>Hourly drain: {status.hourlyDrainFC?.toFixed(1) || 0} FC / {status.hourlyDrainCapPct}% cap</span>
        <span>Swaps/hr: {status.swapsLastHour || 0}</span>
      </div>

      {/* Recent Swaps */}
      {status.recentSwaps?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>Recent Trades</h4>
          {status.recentSwaps.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa', padding: '4px 0', borderBottom: '1px solid #222' }}>
              <span>{fmt(s.fc, 2)} FC</span>
              <span>{fmt(s.eth, 8)} ETH</span>
              <span>{new Date(s.time).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tier Progression */}
      <div style={{ marginTop: 16 }}>
        <h4 style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>Scaling Tiers</h4>
        {TIERS.map(t => {
          const active = t === currentTier;
          return (
            <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', borderRadius: 4, background: active ? '#1a1a2e' : 'transparent', color: active ? t.color : '#555', borderLeft: active ? `2px solid ${t.color}` : '2px solid transparent' }}>
              <span>{t.icon} {t.name}</span>
              <span>{t.max === Infinity ? '$10M+' : t.max >= 1_000_000 ? '$' + (t.max/1_000_000) + 'M' : t.max >= 1_000 ? '$' + (t.max/1_000) + 'K' : '$' + t.max}</span>
              <span>{t.profit}% profit / {t.reinvest}% reinvest</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pool Economy Panel ─────────────────────────────────────────
function PoolEconomyPanel({ chain }) {
  const { status } = useDirectorAI();
  if (!status) return null;

  // Fee split: derive from pool depth since portal Director doesn't track it
  const poolUsd = chain.poolLiquidityUsd || 0;
  const feeSplitBps = poolUsd < 1000 ? 8000 : poolUsd < 10000 ? 5000 : poolUsd < 100000 ? 3000 : 2000;
  const familyPct = Math.round(feeSplitBps / 100);
  const mainPoolPct = 100 - familyPct;
  const splitLabel = poolUsd < 1000 ? 'Attract members' : poolUsd < 10000 ? 'Balanced' : poolUsd < 100000 ? 'Fund buybacks' : 'Max buyback capital';

  return (
    <div className="section">
      <h2>Pool Economy</h2>
      <p className="section-sub">MainPool buybacks, fee split, and strategic burns -- the self-sustaining loop.</p>
      <div className="stats-grid stats-grid-4">
        <StatCard
          label="MainPool ETH"
          value={fmt(status.totalEthReinvested || 0, 6)}
          sub={'$' + fmt((status.totalEthReinvested || 0) * (chain.ethPrice || 0))}
          color="#3b82f6"
        />
        <StatCard
          label="Last Buyback"
          value={status.recentProfitSplits?.length > 0
            ? new Date(status.recentProfitSplits[0].time).toLocaleDateString()
            : 'None yet'}
          sub={status.reinvestCount > 0 ? `${status.reinvestCount} reinvests` : 'Waiting for activity'}
          color="#f59e0b"
        />
        <StatCard
          label="Fee Split"
          value={`${familyPct}% / ${mainPoolPct}%`}
          sub={`${splitLabel} (Family / MainPool)`}
          color="#10b981"
        />
        <StatCard
          label="Total Swaps"
          value={status.totalSwapCount || 0}
          sub={`${fmt(status.totalFcSold || 0, 2)} FC sold`}
          color="#ef4444"
        />
      </div>
    </div>
  );
}

// ─── Main Trade Page ─────────────────────────────────────────────
export default function Trade({ chain, wallet }) {
  const [liqFC, setLiqFC] = useState('50000');
  const [liqETH, setLiqETH] = useState('0.005');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [slippage, setSlippage] = useState(() => {
    const saved = localStorage.getItem('fc_portal_slippage');
    return saved ? Number(saved) : 5;
  });
  const tradingReady = chain.poolExists;

  const handleAddLiquidity = async () => {
    const fc = parseFloat(liqFC);
    const eth = parseFloat(liqETH);
    if (!fc || !eth) { setResult({ ok: false, msg: 'Enter both amounts' }); return; }
    setBusy(true);
    setResult({ ok: true, msg: 'Confirm in MetaMask...' });
    try {
      const tx = await actionAddLiquidity(fc, eth, slippage);
      setResult({ ok: true, msg: `Liquidity added! TX: ${tx.slice(0, 10)}... Refresh in a few seconds to see trading go live.` });
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('4001') || msg.includes('rejected')) setResult({ ok: false, msg: 'Rejected by user' });
      else setResult({ ok: false, msg: msg.slice(0, 120) });
    }
    setBusy(false);
  };

  return (
    <div className="page">
      <h1>Buy & Sell FC</h1>
      <p className="page-sub">Trade FractalCoin on Uniswap. FC trades on the Base network, so fees are just pennies.</p>

      {/* Current Price */}
      <div className="stats-grid stats-grid-3">
        <StatCard
          label="FC Price"
          value={chain.fcPriceUsd < 0.01 ? '$' + chain.fcPriceUsd.toFixed(6) : '$' + fmt(chain.fcPriceUsd)}
          sub={chain.fcPrice > 0 ? fmt(chain.fcPrice, 8) + ' ETH per FC' : 'No pool yet'}
          color="#00ffcc"
        />
        <StatCard
          label="Pool Depth"
          value={'$' + fmt(chain.poolLiquidityUsd)}
          sub="Total liquidity"
          color="#3b82f6"
        />
        <StatCard
          label="ETH Price"
          value={'$' + fmt(chain.ethPrice)}
          color="#f59e0b"
        />
      </div>

      {/* Wallet not connected — prompt to connect */}
      {!wallet.account && (
        <div className="section" style={{ borderLeft: '3px solid #f59e0b' }}>
          <h2 style={{ color: '#f59e0b' }}>Connect Your Wallet</h2>
          <p className="section-sub">Connect MetaMask to start trading FC. The Director AI needs wallet access to execute trades.</p>
          <button className="btn btn-primary" onClick={async () => {
            try { await window.ethereum?.request({ method: 'eth_requestAccounts' }); } catch {}
          }}>Connect MetaMask</button>
        </div>
      )}

      {/* Wrong network — prompt to switch */}
      {wallet.account && !wallet.isBase && (
        <div className="section" style={{ borderLeft: '3px solid #ef4444' }}>
          <h2 style={{ color: '#ef4444' }}>Wrong Network</h2>
          <p className="section-sub">You're connected but not on Base. FC trades on the Base network.</p>
          <button className="btn btn-primary" onClick={async () => {
            try { await window.ethereum?.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); } catch(e) {
              if (e.code === 4902) { try { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] }); } catch {} }
            }
          }}>Switch to Base Network</button>
        </div>
      )}

      {/* Director AI — shows when pool exists and wallet connected */}
      {wallet.account && wallet.isBase && tradingReady && (
        <DirectorPanel chain={chain} />
      )}

      {/* Pool Economy — fee split, buybacks, burns */}
      {wallet.account && wallet.isBase && tradingReady && (
        <PoolEconomyPanel chain={chain} />
      )}

      {/* Add Liquidity — only shows when pool has no reserves */}
      {wallet.account && wallet.isBase && !tradingReady && (
        <div className="section">
          <h2>Launch Trading</h2>
          <p className="section-sub">Everything is set up. Just add FC + ETH to create the trading pool. One MetaMask confirm.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>FC Amount</label>
              <input type="number" value={liqFC} onChange={e => setLiqFC(e.target.value)} className="pool-input" />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>ETH Amount</label>
              <input type="number" value={liqETH} onChange={e => setLiqETH(e.target.value)} className="pool-input" step="0.001" />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Slippage:</label>
            {[1, 3, 5, 10].map(pct => (
              <button key={pct} onClick={() => { setSlippage(pct); localStorage.setItem('fc_portal_slippage', String(pct)); }}
                className={slippage === pct ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                style={{ fontSize: 11, padding: '4px 10px', minWidth: 0 }}>
                {pct}%
              </button>
            ))}
          </div>
          <button onClick={handleAddLiquidity} disabled={busy} className="btn btn-primary" style={{ width: '100%' }}>
            {busy ? 'Confirm in MetaMask...' : 'Add Liquidity & Go Live'}
          </button>
          <div className="pool-join-note" style={{ marginTop: 8 }}>
            This sets the initial FC price. {liqFC && liqETH && parseFloat(liqETH) > 0 && parseFloat(liqFC) > 0
              ? `${parseFloat(liqFC).toLocaleString()} FC + ${liqETH} ETH = ~$${((parseFloat(liqETH) * chain.ethPrice) / parseFloat(liqFC)).toFixed(6)}/FC`
              : ''}
          </div>
          {result && <div className={`pool-result ${result.ok ? 'ok' : 'err'}`} style={{ marginTop: 8 }}>{result.msg}</div>}
        </div>
      )}

      {/* Your Holdings */}
      {wallet.account && wallet.isBase && (
        <div className="section">
          <h2>Your Holdings</h2>
          <div className="stats-grid stats-grid-2">
            <StatCard
              label="FC Balance"
              value={fmt(chain.walletFC, 2) + ' FC'}
              sub={'Worth $' + fmt(chain.walletFC * chain.fcPriceUsd)}
              color="#00ffcc"
            />
            <StatCard
              label="ETH Balance"
              value={fmt(chain.walletETH, 6) + ' ETH'}
              sub={'Worth $' + fmt(chain.walletETH * chain.ethPrice)}
              color="#f59e0b"
            />
          </div>
        </div>
      )}

      {/* Trade Buttons */}
      <div className="section">
        <h2>Trade on Uniswap</h2>
        {!tradingReady && (
          <p className="section-sub" style={{ color: '#f59e0b' }}>Add liquidity above to enable trading.</p>
        )}
        {tradingReady && (
          <p className="section-sub">Click a button below to open Uniswap with FC pre-loaded. Just enter the amount and confirm.</p>
        )}
        <div className="trade-buttons">
          <a href={UNISWAP_BUY_URL} target="_blank" rel="noreferrer" className={'trade-btn buy' + (!tradingReady ? ' disabled' : '')}>
            <span className="trade-btn-icon">+</span>
            <span className="trade-btn-label">Buy FC</span>
            <span className="trade-btn-sub">Swap ETH for FC</span>
          </a>
          <a href={UNISWAP_SELL_URL} target="_blank" rel="noreferrer" className={'trade-btn sell' + (!tradingReady ? ' disabled' : '')}>
            <span className="trade-btn-icon">-</span>
            <span className="trade-btn-label">Sell FC</span>
            <span className="trade-btn-sub">Swap FC for ETH</span>
          </a>
        </div>
      </div>

      {/* How to Buy Guide */}
      <div className="section">
        <h2>How to Buy FC (Step by Step)</h2>
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <div>
              <strong>Install MetaMask</strong>
              <p>Download from <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">metamask.io</a> — it's free. Works as a browser extension or mobile app.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <div>
              <strong>Add the Base Network</strong>
              <p>Click "Connect Wallet" above — we'll add Base automatically. Or add it manually in MetaMask settings.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <div>
              <strong>Get ETH on Base</strong>
              <p>Buy ETH on Coinbase and send it to your MetaMask address on the Base network. You can also use the Coinbase Bridge.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">4</div>
            <div>
              <strong>Swap ETH for FC</strong>
              <p>Click "Buy FC" above. Uniswap opens with FC pre-selected. Enter the amount of ETH you want to spend and hit Swap.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">5</div>
            <div>
              <strong>Confirm in MetaMask</strong>
              <p>MetaMask pops up asking you to confirm. Check the details, click Confirm. Gas on Base is usually under $0.01.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Add FC to MetaMask */}
      <div className="section">
        <h2>Add FC to Your Wallet</h2>
        <p className="section-sub">After buying, add the FC token to MetaMask so you can see your balance:</p>
        <div className="token-import">
          <div className="contract-row">
            <span className="contract-label">Contract:</span>
            <span className="contract-addr-copy">{FC_TOKEN}</span>
          </div>
          <div className="contract-row">
            <span className="contract-label">Symbol:</span>
            <span>FC</span>
          </div>
          <div className="contract-row">
            <span className="contract-label">Decimals:</span>
            <span>18</span>
          </div>
          <div className="contract-row">
            <span className="contract-label">Network:</span>
            <span>Base</span>
          </div>
        </div>
        <p className="hint">In MetaMask: click "Import Tokens" at the bottom, paste the contract address above, and hit Add.</p>
      </div>

      {/* Rules */}
      <div className="section">
        <h2>Trading Rules & Safety</h2>
        <div className="rules-grid">
          <div className="rule">
            <strong>No single trade drains more than 2%</strong>
            <p>The Director AI limits every swap to protect pool stability.</p>
          </div>
          <div className="rule">
            <strong>Auto-pause on high impact</strong>
            <p>If a trade would move the price more than 8%, trading pauses automatically.</p>
          </div>
          <div className="rule">
            <strong>Gas-positive only</strong>
            <p>No trade executes unless the profit exceeds the gas cost.</p>
          </div>
          <div className="rule">
            <strong>Gas reserve always maintained</strong>
            <p>Director keeps 0.0002 ETH (~$0.50) reserved for gas at all times. Never runs dry.</p>
          </div>
          <div className="rule">
            <strong>Adaptive scaling</strong>
            <p>Starts with micro-trades. As liquidity grows, trade size scales up automatically.</p>
          </div>
          <div className="rule">
            <strong>Fully on-chain</strong>
            <p>All trades happen on the Base blockchain. Verify everything on BaseScan.</p>
          </div>
        </div>
      </div>

      <div className="section">
        <a href={BASESCAN_TOKEN} target="_blank" rel="noreferrer" className="btn btn-outline">
          View Full Token Data on BaseScan
        </a>
      </div>
    </div>
  );
}
