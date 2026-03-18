import React from 'react';
import StatCard from '../components/StatCard';
import ProgressBar from '../components/ProgressBar';
import { BASESCAN_TOKEN, UNISWAP_BUY_URL } from '../config';
import { usePoolData } from '../hooks/usePoolData';

export default function Dashboard({ chain, wallet }) {
  const { pools, membership, myMetrics } = usePoolData(wallet.account);
  const fmt = (n, d = 2) => n?.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) || '0';
  const fmtUsd = (n) => '$' + fmt(n);

  return (
    <div className="page">
      {/* Hero */}
      <div className="hero">
        <h1>FractalCoin <span className="highlight">FC</span></h1>
        <p className="hero-sub">A self-growing community token on Base. Join the pool, earn your share, watch it grow.</p>
        {!wallet.account && (
          <button onClick={wallet.connect} className="btn btn-primary btn-lg">
            Connect Wallet to Get Started
          </button>
        )}
      </div>

      {/* Live Stats Grid */}
      <div className="stats-grid">
        <StatCard
          label="FC Price"
          value={chain.fcPriceUsd < 0.01 ? '$' + chain.fcPriceUsd.toFixed(6) : fmtUsd(chain.fcPriceUsd)}
          sub={chain.fcPrice > 0 ? fmt(chain.fcPrice, 8) + ' ETH' : 'No pool yet'}
          color="#00ffcc"
        />
        <StatCard
          label="Pool Liquidity"
          value={fmtUsd(chain.poolLiquidityUsd)}
          sub={`${fmt(chain.poolReserveFC, 0)} FC + ${fmt(chain.poolReserveETH, 6)} ETH`}
          color="#3b82f6"
        />
        <StatCard
          label="ETH Price"
          value={fmtUsd(chain.ethPrice)}
          sub="Live from CoinGecko"
          color="#f59e0b"
        />
        <StatCard
          label="Total Supply"
          value={fmt(chain.totalSupply, 0) + ' FC'}
          sub="21M max"
          color="#8b5cf6"
        />
      </div>

      {/* Wallet Balance (only when connected) */}
      {wallet.account && wallet.isBase && (
        <div className="section">
          <h2>Your Wallet</h2>
          <div className="stats-grid stats-grid-2">
            <StatCard
              label="Your FC Balance"
              value={fmt(chain.walletFC, 2) + ' FC'}
              sub={fmtUsd(chain.walletFC * chain.fcPriceUsd)}
              color="#00ffcc"
            />
            <StatCard
              label="Your ETH Balance"
              value={fmt(chain.walletETH, 6) + ' ETH'}
              sub={fmtUsd(chain.walletETH * chain.ethPrice)}
              color="#f59e0b"
            />
          </div>
        </div>
      )}

      {/* Portfolio (only when connected + has pool memberships) */}
      {wallet.account && wallet.isBase && (() => {
        const myPoolIds = pools.filter(p => membership[p.id]).map(p => p.id);
        const totalDeposited = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.depositedETH || 0), 0);
        const totalClaimable = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.claimable || 0), 0);
        const totalClaimed = myPoolIds.reduce((sum, id) => sum + (myMetrics[id]?.rewardsClaimed || 0), 0);
        const netPosition = totalDeposited + totalClaimable - totalClaimed;
        const fcValue = (chain.walletFC || 0) * (chain.fcPriceUsd || 0);
        const ethValue = (chain.walletETH || 0) * (chain.ethPrice || 0);

        return (
          <div className="section">
            <h2>Your Portfolio</h2>
            <div className="stats-grid">
              <StatCard
                label="FC Holdings"
                value={fmt(chain.walletFC, 2) + ' FC'}
                sub={fmtUsd(fcValue)}
                color="#00ffcc"
              />
              <StatCard
                label="ETH Holdings"
                value={fmt(chain.walletETH, 6) + ' ETH'}
                sub={fmtUsd(ethValue)}
                color="#f59e0b"
              />
              <StatCard
                label="Pool Memberships"
                value={myPoolIds.length.toString()}
                sub={myPoolIds.length > 0 ? pools.filter(p => membership[p.id]).map(p => p.name).join(', ') : 'None yet'}
                color="#3b82f6"
              />
              <StatCard
                label="Total Deposited"
                value={fmt(totalDeposited, 6) + ' ETH'}
                sub={fmtUsd(totalDeposited * chain.ethPrice)}
                color="#8b5cf6"
              />
              <StatCard
                label="Claimable Rewards"
                value={fmt(totalClaimable, 4) + ' FC'}
                sub={totalClaimable > 0 ? 'Claim on Pools page' : 'No rewards yet'}
                color="#10b981"
              />
              <StatCard
                label="Net Position"
                value={fmt(netPosition, 6) + ' ETH'}
                sub={fmtUsd(netPosition * chain.ethPrice)}
                color={netPosition >= 0 ? '#00ffcc' : '#ef4444'}
              />
            </div>
          </div>
        );
      })()}

      {/* Token Allocation */}
      {chain.allocation && (
        <div className="section">
          <h2>Token Allocation</h2>
          <div className="allocation-bars">
            {[
              { label: 'Mining',   minted: chain.allocation.mined,     cap: 10_500_000, color: '#f59e0b' },
              { label: 'Deposits', minted: chain.allocation.deposited, cap: 6_300_000,  color: '#3b82f6' },
              { label: 'Treasury', minted: chain.allocation.treasury,  cap: 2_100_000,  color: '#8b5cf6' },
              { label: 'Founder',  minted: chain.allocation.founder,   cap: 2_100_000,  color: '#10b981' },
            ].map(b => (
              <div key={b.label} className="alloc-bar-row" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: b.color }}>{b.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {fmt(b.minted, 0)} / {fmt(b.cap, 0)} FC
                  </span>
                </div>
                <div className="progress-track" style={{ height: 10 }}>
                  <div className="progress-fill" style={{
                    width: (b.cap > 0 ? Math.min((b.minted / b.cap) * 100, 100) : 0) + '%',
                    background: b.color,
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, textAlign: 'right' }}>
                  {b.cap > 0 ? ((b.minted / b.cap) * 100).toFixed(2) : '0'}%
                </div>
              </div>
            ))}
            {chain.allocation.burned > 0 && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                Total Burned: {fmt(chain.allocation.burned, 2)} FC
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="section">
        <h2>Growth Progress</h2>
        <ProgressBar poolLiquidityUsd={chain.poolLiquidityUsd} />
      </div>

      {/* Quick Actions */}
      <div className="section">
        <h2>Quick Links</h2>
        <div className="actions-row">
          <a href={UNISWAP_BUY_URL} target="_blank" rel="noreferrer" className="btn btn-primary">
            Buy FC on Uniswap
          </a>
          <a href={BASESCAN_TOKEN} target="_blank" rel="noreferrer" className="btn btn-outline">
            View on BaseScan
          </a>
        </div>
      </div>

      {/* Live Status */}
      <div className="section">
        <div className="status-bar">
          <span className={'status-dot' + (chain.poolExists ? ' live' : '')} />
          {chain.loading ? 'Loading chain data...' :
           chain.poolExists ? 'Pool is live and trading' :
           'Pool not yet created'}
          <span className="status-refresh">Live — updates every 15s</span>
        </div>
      </div>
    </div>
  );
}
