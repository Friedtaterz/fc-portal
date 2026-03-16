import React from 'react';
import { TIERS } from '../config';

export default function ProgressBar({ poolLiquidityUsd }) {
  const value = poolLiquidityUsd || 0;

  // Find current tier
  let currentTier = TIERS[0];
  let tierIndex = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (value < TIERS[i].max) { currentTier = TIERS[i]; tierIndex = i; break; }
  }

  // Progress within current tier
  const prevMax = tierIndex > 0 ? TIERS[tierIndex - 1].max : 0;
  const range = currentTier.max === Infinity ? 100_000_000 : currentTier.max - prevMax;
  const progress = Math.min(((value - prevMax) / range) * 100, 100);

  // Format number
  const fmt = (n) => {
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  };

  return (
    <div className="progress-section">
      <div className="progress-header">
        <span className="progress-tier">
          {currentTier.icon} {currentTier.name}
        </span>
        <span className="progress-value">{fmt(value)}</span>
      </div>

      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: progress + '%', background: currentTier.color }}
        />
      </div>

      <div className="progress-labels">
        <span>{fmt(prevMax)}</span>
        <span className="progress-split">
          {currentTier.profit}% profit / {currentTier.reinvest}% reinvest
        </span>
        <span>{currentTier.max === Infinity ? '$10M+' : fmt(currentTier.max)}</span>
      </div>

      {/* Tier roadmap */}
      <div className="tier-roadmap">
        {TIERS.map((t, i) => (
          <div
            key={t.name}
            className={'tier-dot' + (i <= tierIndex ? ' reached' : '')}
            style={{ borderColor: t.color }}
          >
            <span className="tier-dot-icon">{t.icon}</span>
            <span className="tier-dot-label">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
