import React from 'react';
import StatCard from '../components/StatCard';
import ProgressBar from '../components/ProgressBar';
import { BASESCAN_TOKEN, UNISWAP_BUY_URL } from '../config';

export default function Dashboard({ chain, wallet }) {
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
          <span className="status-refresh">Auto-refreshes every 15s</span>
        </div>
      </div>
    </div>
  );
}
