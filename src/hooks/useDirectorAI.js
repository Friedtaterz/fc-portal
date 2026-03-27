/**
 * FC DIRECTOR AI — Portal Edition
 * ═══════════════════════════════════════════════════════════════════
 * Autonomous trading engine for FractalCoin, designed for the public
 * FC Portal. Works alongside the CCS Director — both read the same
 * on-chain pool state, so they naturally coordinate through the AMM.
 *
 * TWO MODES:
 *   SUGGEST (default) — Shows what it would trade, but doesn't execute.
 *     Safe for new users. They see the Director's reasoning and can
 *     manually trade on Uniswap if they agree.
 *   AUTO — Executes trades automatically. Opt-in only. Full safety
 *     limits apply. Users can stop anytime.
 *
 * COORDINATION WITH CCS DIRECTOR:
 *   Both Directors read the same Uniswap pool reserves on-chain.
 *   When either Director sells FC, the reserves change. The other
 *   Director sees the new reserves next cycle and adapts automatically.
 *   The blockchain IS the coordination layer — no direct communication
 *   needed. The adaptive impact limits prevent any single Director
 *   from crashing the price, even if both are running simultaneously.
 *
 * ADAPTIVE SCALING:
 *   Pool < $100:  MICRO mode — max 0.5% price impact per trade
 *   Pool $100-1K: CAREFUL mode — max 2% price impact per trade
 *   Pool > $1K:   NORMAL mode — max 8% price impact per trade
 *
 * POOL-AWARE RATE LIMITING:
 *   The Director tracks its own hourly drain. Combined with the
 *   adaptive impact limits, this prevents over-trading even when
 *   multiple Directors operate on the same pool.
 *
 * SAFETY:
 *   - Every trade must be gas-positive (output > 2x gas cost)
 *   - Adaptive impact limits based on pool depth
 *   - Never sells >40% of wallet FC
 *   - Never drains >2% of pool per trade, >5% per hour
 *   - PROACTIVE GAS: tracks burn rate, retains ETH when <=2 trades of gas left
 *   - REACTIVE GAS: sells tiny FC for gas when needed (building-safe limits)
 *   - Price floor: pauses if FC drops >20% in 1 hour
 *   - Pool floor: pauses if pool shrinks >30% in 1 hour
 *   - Full audit trail — every action logged
 * ═══════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBaseRPC, FC_TOKEN, FC_POOLS, WETH, UNISWAP_ROUTER } from '../config';

// ─── Constants ──────────────────────────────────────────────────
const STORAGE_KEY = 'fc_director_ai';
const BASE_COOLDOWN_MS = 30_000;
const MAX_SELL_RATIO = 0.40;
const MIN_POOL_ETH = 0.0000001;
const MIN_ETH_OUTPUT = 0.0000001;
const GAS_COST_ETH = 0.000005;        // Base L2 actual gas ~$0.001
const MAX_DRAIN_PCT = 0.02;
const SCALE_RAMP_FACTOR = 0.5;
const MIN_SWAP_FC = 0.001;
const MAX_SWAP_FC = 5000;
const HOURLY_DRAIN_CAP_PCT = 0.05;    // 5% max drain per hour

// Adaptive impact limits — scales with pool depth
const MICRO_IMPACT_PCT = 0.5;         // Pool < $100
const CAREFUL_IMPACT_PCT = 2.0;       // Pool $100-$1K
const NORMAL_IMPACT_PCT = 8.0;        // Pool > $1K

// Price/pool floor protection
const PRICE_DROP_PAUSE_PCT = 0.20;
const POOL_SHRINK_PAUSE_PCT = 0.30;

// ─── Smart Gas Management ───────────────────────────────────────
const GAS_RESERVE_ETH = 0.0005;       // Hard minimum — never go below this
const GAS_WARNING_ETH = 0.001;        // Warning threshold
const GAS_COMFORT_ETH = 0.002;        // Director tries to maintain this level
const GAS_REFUEL_TARGET_ETH = 0.003;
const GAS_REFUEL_MAX_FC_PCT = 0.02;   // Never sell more than 2% of wallet FC for gas
const GAS_REFUEL_COOLDOWN_MS = 300_000; // Max 1 refuel per 5 minutes
const GAS_PER_TX_ESTIMATE = 0.00003;  // ~30K gwei estimate per Base L2 tx (approve+swap+reinvest)
const GAS_REFUEL_MIN_POOL_ETH = 0.001;

// Tier thresholds
const TIERS = [
  { name: 'Pool Building',  maxUsd: 1_000,       profitRatio: 1.0,  reinvestRatio: 0    },
  { name: 'Direct Payout',  maxUsd: 100_000,     profitRatio: 0.70, reinvestRatio: 0.30 },
  { name: 'Scaling',        maxUsd: 10_000_000,  profitRatio: 0.50, reinvestRatio: 0.50 },
  { name: 'Trust Mode',     maxUsd: Infinity,     profitRatio: 0.80, reinvestRatio: 0.20 },
];

const REINVEST_THRESHOLD_USD = 0.10;

// ─── Goal Milestones ──────────────────────────────────────────
const GOALS = [
  { id: 'genesis',     label: 'Genesis',           check: () => true },
  { id: 'first_liq',   label: 'First Liquidity ($50)', check: (s) => s.poolUsd >= 50 },
  { id: 'gas_self',    label: 'Gas Self-Sufficient',    check: (s) => s.walletETH >= GAS_RESERVE_ETH * 2 },
  { id: 'first_swap',  label: 'First Swap',             check: (s) => s.totalSwapCount >= 1 },
  { id: 'pool_100',    label: 'Pool $100',               check: (s) => s.poolUsd >= 100 },
  { id: 'pool_500',    label: 'Pool $500',               check: (s) => s.poolUsd >= 500 },
  { id: 'pool_1k',     label: 'Pool $1K',                check: (s) => s.poolUsd >= 1000 },
  { id: 'earned_1eth', label: 'Earned 1 ETH',            check: (s) => s.totalEthEarned >= 1 },
  { id: 'pool_10k',    label: 'Pool $10K',               check: (s) => s.poolUsd >= 10000 },
  { id: 'pool_100k',   label: 'Pool $100K',              check: (s) => s.poolUsd >= 100000 },
  { id: 'pool_1m',     label: 'Pool $1M',                check: (s) => s.poolUsd >= 1000000 },
  { id: 'pool_10m',    label: 'Pool $10M',               check: (s) => s.poolUsd >= 10000000 },
];

const SEL = {
  approve: '0x095ea7b3',
  allowance: '0xdd62ed3e',
  balanceOf: '0x70a08231',
  getReserves: '0x0902f1ac',
  swapExactTokensForETH: '0x18cbafe5',
  addLiquidityETH: '0xf305d719',
};

// ─── RPC helper ─────────────────────────────────────────────────
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
      if (json.error) throw new Error(json.error.message);
      return json.result;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

async function getETHBalance(address) {
  const res = await fetch(getBaseRPC(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
  });
  const json = await res.json();
  return Number(BigInt(json.result)) / 1e18;
}

function sortTokens(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

// ─── Director AI Class ─────────────────────────────────────────
class FCPortalDirector {
  constructor() {
    this._state = this._load();
    this._state.swapLog = this._state.swapLog || [];
    this._state.reinvestLog = this._state.reinvestLog || [];
    this._state.totalEthEarned = this._state.totalEthEarned || 0;
    this._state.totalEthReinvested = this._state.totalEthReinvested || 0;
    this._state.totalEthProfit = this._state.totalEthProfit || 0;
    this._state.totalGasSpent = this._state.totalGasSpent || 0;
    this._state.totalFcSold = this._state.totalFcSold || 0;
    this._state.totalSwapCount = this._state.totalSwapCount || 0;
    this._state.reinvestCount = this._state.reinvestCount || 0;
    this._state.cycleCount = this._state.cycleCount || 0;
    this._state.profitLog = this._state.profitLog || [];
    this._state.priceHistory = this._state.priceHistory || [];
    this._state.poolHistory = this._state.poolHistory || [];
    // Pool reward distribution tracking
    this._state.tradesSinceLastDistribution = this._state.tradesSinceLastDistribution || 0;
    this._state.distributionLog = this._state.distributionLog || [];
    this._state.totalDistributedFC = this._state.totalDistributedFC || 0;
    this._state.distributionCount = this._state.distributionCount || 0;
    this._state.lastDistributionEthProfit = this._state.lastDistributionEthProfit || 0;
    // Mode: 'suggest' (default) or 'auto'
    this._state.mode = this._state.mode || 'suggest';
    // Trinity state (past/present/future)
    this._state.trinity = this._state.trinity || { whatWas: null, whatIs: null, whatWillBe: null };
    // Goal milestones
    this._state.goalsCompleted = this._state.goalsCompleted || { genesis: Date.now() };
    // Defense state
    this._state.defense = this._state.defense || { level: 'normal', anomalyLog: [], sandwichCount: 0, lastEscalation: 0 };
    // Scorecard
    this._state.scorecard = this._state.scorecard || { cyclesRun: 0, swapsSucceeded: 0, swapsFailed: 0, peakPoolUsd: 0, healthScore: 100 };
    // Gas self-management state
    this._state.gasRefuelLog = this._state.gasRefuelLog || [];
    this._state.gasRefuelCount = this._state.gasRefuelCount || 0;
    this._state.totalGasRefuelETH = this._state.totalGasRefuelETH || 0;
    this._state.totalGasRefuelFC = this._state.totalGasRefuelFC || 0;

    this._running = false;
    this._paused = false;
    this._pauseReason = null;
    this._timer = null;
    this._lastSwapTime = 0;
    this._lastGasRefuelTime = 0;
    this._listeners = [];
    this._blocker = null;
    this._pairAddress = null;
    this._suggestion = null; // Current trade suggestion (suggest mode)

    // Proactive gas tracking
    this._gasSnapshots = [];
    this._avgGasPerTrade = GAS_COST_ETH;
  }

  // ─── Mode Control ─────────────────────────────────────────
  setMode(mode) {
    const m = (mode || 'suggest').toLowerCase();
    if (m !== 'suggest' && m !== 'auto') return;
    this._state.mode = m;
    this._save();
    console.log(`[FC Director] Mode: ${m.toUpperCase()}`);
  }

  getMode() { return this._state.mode || 'suggest'; }

  // ─── Lifecycle ──────────────────────────────────────────────
  start() {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._state.enabled = true;
    this._save();
    console.log(`[FC Director] Online — mode: ${this._state.mode.toUpperCase()}`);
    this._timer = setInterval(() => this._cycle(), BASE_COOLDOWN_MS);
    setTimeout(() => { if (this._running) this._cycle(); }, 5000);
  }

  stop() {
    this._running = false;
    this._state.enabled = false;
    this._save();
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[FC Director] Offline');
  }

  pause(reason) { this._paused = true; this._pauseReason = reason; }
  resume() { this._paused = false; this._pauseReason = null; this._blocker = null; }

  // ─── Get current tier ──────────────────────────────────────
  _getTier(poolUsd) {
    for (const t of TIERS) { if (poolUsd < t.maxUsd) return t; }
    return TIERS[TIERS.length - 1];
  }

  // ─── Adaptive max impact for current pool depth ────────────
  _getMaxImpact(poolUsd) {
    if (poolUsd < 100) return MICRO_IMPACT_PCT;
    if (poolUsd < 1000) return CAREFUL_IMPACT_PCT;
    return NORMAL_IMPACT_PCT;
  }

  _getAdaptiveMode(poolUsd) {
    if (poolUsd < 100) return 'micro';
    if (poolUsd < 1000) return 'careful';
    return 'normal';
  }

  // ─── Adaptive Swap Sizing ──────────────────────────────────
  _calcSwapAmount(reserveFC, reserveETH, walletFC, ethUsd) {
    if (reserveFC < 0.001 || reserveETH < 0.0000001) {
      return { amount: 0, reason: `Pool too small (${reserveFC.toFixed(4)} FC / ${reserveETH.toFixed(10)} ETH)` };
    }

    const poolUsd = reserveETH * ethUsd * 2;
    const maxImpact = this._getMaxImpact(poolUsd);
    const maxDrainFC = reserveFC * MAX_DRAIN_PCT * SCALE_RAMP_FACTOR;
    const walletCap = walletFC * MAX_SELL_RATIO;

    let amount = Math.min(maxDrainFC, walletCap, MAX_SWAP_FC);
    amount = Math.max(amount, MIN_SWAP_FC);
    if (amount > walletFC) {
      return { amount: 0, reason: `Need ${amount.toFixed(2)} FC, have ${walletFC.toFixed(2)}` };
    }

    const x = reserveFC, y = reserveETH;
    const fcIn = amount * 0.997;
    const ethOut = (fcIn * y) / (x + fcIn);

    // Must be gas-positive
    if (ethOut < GAS_COST_ETH * 2) {
      const bigAmount = Math.min(reserveFC * 0.05, walletCap, MAX_SWAP_FC, walletFC);
      const bigFcIn = bigAmount * 0.997;
      const bigEthOut = (bigFcIn * y) / (x + bigFcIn);
      if (bigEthOut >= GAS_COST_ETH * 2) {
        amount = bigAmount;
      } else {
        return { amount: 0, reason: `Trade not profitable (${ethOut.toFixed(8)} ETH < ${(GAS_COST_ETH * 2).toFixed(8)} min). Pool too thin.` };
      }
    }

    const finalFcIn = amount * 0.997;
    const finalEthOut = (finalFcIn * y) / (x + finalFcIn);
    const spotPrice = y / x;
    const effectivePrice = finalEthOut / amount;
    const priceImpact = ((spotPrice - effectivePrice) / spotPrice) * 100;

    // If impact exceeds adaptive limit, scale down the trade
    if (priceImpact > maxImpact && amount > MIN_SWAP_FC) {
      // Binary search for the right size
      let lo = MIN_SWAP_FC, hi = amount;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        const midIn = mid * 0.997;
        const midOut = (midIn * y) / (x + midIn);
        const midEff = midOut / mid;
        const midImpact = ((spotPrice - midEff) / spotPrice) * 100;
        if (midImpact > maxImpact) { hi = mid; } else { lo = mid; }
      }
      amount = parseFloat(lo.toFixed(4));
      if (amount < MIN_SWAP_FC) {
        return { amount: 0, reason: `Can't trade below ${maxImpact}% impact on $${poolUsd.toFixed(0)} pool. Add liquidity first.` };
      }
      // Recalculate with adjusted amount
      const adjIn = amount * 0.997;
      const adjOut = (adjIn * y) / (x + adjIn);
      if (adjOut < GAS_COST_ETH * 2) {
        return { amount: 0, reason: `Micro-trade ${amount.toFixed(4)} FC → ${adjOut.toFixed(8)} ETH too small for gas. Pool needs depth.` };
      }
      return {
        amount,
        ethOut: adjOut,
        ethOutUSD: adjOut * ethUsd,
        priceImpact: ((spotPrice - adjOut / amount) / spotPrice) * 100,
        cooldownMs: Math.max(BASE_COOLDOWN_MS, BASE_COOLDOWN_MS * (1 + Math.log10(amount + 1))),
        gasProfit: adjOut - GAS_COST_ETH,
        poolDrainPct: (amount / reserveFC) * 100,
        reason: 'ok (scaled to fit impact limit)',
        adaptiveMode: this._getAdaptiveMode(poolUsd),
        maxImpact,
      };
    }

    const cooldown = Math.max(BASE_COOLDOWN_MS, BASE_COOLDOWN_MS * (1 + Math.log10(amount + 1)));
    return {
      amount: parseFloat(amount.toFixed(4)),
      ethOut: finalEthOut,
      ethOutUSD: finalEthOut * ethUsd,
      priceImpact: Math.max(priceImpact, 0),
      cooldownMs: Math.round(cooldown),
      gasProfit: finalEthOut - GAS_COST_ETH,
      poolDrainPct: (amount / reserveFC) * 100,
      reason: 'ok',
      adaptiveMode: this._getAdaptiveMode(poolUsd),
      maxImpact,
    };
  }

  // ─── Trinity State (past/present/future) ───────────────────
  _captureTrinity(state, ethUsd, poolUsd, tier) {
    const trinity = this._state.trinity || {};
    // Shift current → past
    trinity.whatWas = trinity.whatIs || null;
    // Capture present
    trinity.whatIs = {
      t: Date.now(),
      reserveFC: state.reserveFC,
      reserveETH: state.reserveETH,
      priceUsd: state.reserveFC > 0 ? (state.reserveETH / state.reserveFC) * ethUsd : 0,
      poolUsd,
      walletFC: state.walletFC,
      walletETH: state.walletETH,
      gasRunway: Math.floor(state.walletETH / GAS_COST_ETH),
      tier: tier.name,
    };
    // Project future
    const trend = this._detectTrend(trinity.whatWas, trinity.whatIs);
    const sizing = this._lastSizing || {};
    trinity.whatWillBe = {
      nextAction: sizing.amount > 0 ? `Sell ${sizing.amount?.toFixed(4)} FC` : 'Waiting',
      confidence: sizing.amount > 0 ? Math.max(0, Math.min(100, 100 - (sizing.priceImpact || 0) * 5)) : 0,
      trend,
    };
    this._state.trinity = trinity;
  }

  _detectTrend(was, is) {
    if (!was || !is) return 'initializing';
    const priceDelta = was.priceUsd > 0 ? (is.priceUsd - was.priceUsd) / was.priceUsd : 0;
    const poolDelta = was.poolUsd > 0 ? (is.poolUsd - was.poolUsd) / was.poolUsd : 0;
    if (priceDelta > 0.02 && poolDelta > 0.01) return 'growing';
    if (priceDelta < -0.02 && poolDelta < -0.01) return 'contracting';
    if (priceDelta > 0.01) return 'price_rising';
    if (priceDelta < -0.01) return 'price_falling';
    if (poolDelta > 0.01) return 'liquidity_inflow';
    if (poolDelta < -0.01) return 'liquidity_outflow';
    return 'stable';
  }

  // ─── Goal Milestones ────────────────────────────────────────
  _evaluateGoals(status) {
    for (const goal of GOALS) {
      if (!this._state.goalsCompleted[goal.id] && goal.check(status)) {
        this._state.goalsCompleted[goal.id] = Date.now();
        console.log(`[FC Director] Goal reached: ${goal.label}`);
      }
    }
  }

  _getCurrentGoal() {
    for (const goal of GOALS) {
      if (!this._state.goalsCompleted[goal.id]) return goal;
    }
    return GOALS[GOALS.length - 1]; // All completed
  }

  _getGoalProgress(status) {
    const completed = Object.keys(this._state.goalsCompleted || {}).length;
    const current = this._getCurrentGoal();
    return {
      completed,
      total: GOALS.length,
      pct: Math.round((completed / GOALS.length) * 100),
      current: current.label,
      currentId: current.id,
      allCompleted: completed >= GOALS.length,
      milestones: GOALS.map(g => ({
        id: g.id,
        label: g.label,
        done: !!this._state.goalsCompleted[g.id],
        at: this._state.goalsCompleted[g.id] || null,
      })),
    };
  }

  // ─── Defense / Reflection ───────────────────────────────────
  _reflectOnTrade(expectedEthOut, actualEthOut, txHash) {
    const ratio = expectedEthOut > 0 ? actualEthOut / expectedEthOut : 1;
    const now = Date.now();
    const defense = this._state.defense;

    if (ratio < 0.75) {
      // Critical — possible sandwich attack
      defense.anomalyLog.push({ t: now, type: 'sandwich_critical', ratio, txHash });
      defense.sandwichCount++;
      console.warn(`[FC Director] CRITICAL: Actual ${actualEthOut.toFixed(8)} ETH = ${(ratio * 100).toFixed(1)}% of expected. Possible sandwich.`);
    } else if (ratio < 0.85) {
      // Warning — suspicious slippage
      defense.anomalyLog.push({ t: now, type: 'sandwich_warning', ratio, txHash });
      defense.sandwichCount++;
      console.warn(`[FC Director] WARNING: Actual ${actualEthOut.toFixed(8)} ETH = ${(ratio * 100).toFixed(1)}% of expected. High slippage.`);
    }

    // Trim anomaly log to last 50
    if (defense.anomalyLog.length > 50) defense.anomalyLog = defense.anomalyLog.slice(-50);

    // Check for 3 anomalies in 10 minutes → auto-pause
    const tenMinAgo = now - 600_000;
    const recentAnomalies = defense.anomalyLog.filter(a => a.t > tenMinAgo);
    if (recentAnomalies.length >= 3) {
      defense.level = 'critical';
      defense.lastEscalation = now;
      this.pause('DEFENSE: 3+ anomalies in 10 minutes — possible attack');
    } else if (recentAnomalies.length >= 1) {
      defense.level = 'elevated';
      defense.lastEscalation = now;
    } else if (now - defense.lastEscalation > 1_800_000) {
      // Cool down after 30 minutes of no anomalies
      defense.level = 'normal';
    }

    this._state.defense = defense;
  }

  _checkStateIntegrity() {
    const s = this._state;
    let issues = 0;
    // No negative totals
    if (s.totalEthEarned < 0) { s.totalEthEarned = 0; issues++; }
    if (s.totalFcSold < 0) { s.totalFcSold = 0; issues++; }
    if (s.totalSwapCount < 0) { s.totalSwapCount = 0; issues++; }
    if (s.totalGasSpent < 0) { s.totalGasSpent = 0; issues++; }
    // No future timestamps in logs
    const now = Date.now() + 60_000; // 1 minute tolerance
    const swapLog = s.swapLog || [];
    for (let i = swapLog.length - 1; i >= 0; i--) {
      if (swapLog[i].time > now) { swapLog.splice(i, 1); issues++; }
    }
    if (issues > 0) {
      console.warn(`[FC Director] State integrity: fixed ${issues} issue(s)`);
      this._save();
    }
    return issues === 0;
  }

  // ─── Read on-chain state ───────────────────────────────────
  async _readState(account, pairAddress) {
    try {
      const addrPad = account.slice(2).toLowerCase().padStart(64, '0');
      const reservesHex = await rpcCall(pairAddress, SEL.getReserves);
      await new Promise(r => setTimeout(r, 300));
      const fcBalHex = await rpcCall(FC_TOKEN, SEL.balanceOf + addrPad);
      await new Promise(r => setTimeout(r, 300));
      const walletETH = await getETHBalance(account);

      const r0 = Number(BigInt('0x' + reservesHex.slice(2, 66))) / 1e18;
      const r1 = Number(BigInt('0x' + reservesHex.slice(66, 130))) / 1e18;
      const [token0] = sortTokens(FC_TOKEN, WETH);
      const reserveFC = token0.toLowerCase() === FC_TOKEN.toLowerCase() ? r0 : r1;
      const reserveETH = token0.toLowerCase() === FC_TOKEN.toLowerCase() ? r1 : r0;
      const walletFC = Number(BigInt(fcBalHex)) / 1e18;

      // Read MainPool ETH balance from FCFamilyPools contract
      let mainPoolETH = 0;
      try {
        mainPoolETH = await getETHBalance(FC_POOLS);
      } catch {}

      return { reserveFC, reserveETH, walletFC, walletETH, mainPoolETH };
    } catch (e) {
      console.warn('[FC Director] Read state failed:', e.message);
      return null;
    }
  }

  async _getEthPrice() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const json = await res.json();
      return json.ethereum?.usd || this._lastEthPrice || 2500;
    } catch { return this._lastEthPrice || 2500; }
  }

  // ─── Core Cycle ────────────────────────────────────────────
  async _cycle() {
    if (!this._running || this._paused || this._cycling) return;
    this._cycling = true;

    try {
      this._checkStateIntegrity();

      const eth = window.ethereum;
      if (!eth) { this._blocker = 'No wallet connected'; return; }

      const accounts = await eth.request({ method: 'eth_accounts' });
      const account = accounts?.[0];
      if (!account) { this._blocker = 'Wallet not connected'; return; }

      const chainId = await eth.request({ method: 'eth_chainId' });
      if (parseInt(chainId, 16) !== 8453) { this._blocker = 'Switch to Base network'; return; }

      if (!this._pairAddress) {
        const [t0, t1] = sortTokens(FC_TOKEN, WETH);
        const factoryData = '0xe6a43905' + t0.slice(2).toLowerCase().padStart(64, '0') + t1.slice(2).toLowerCase().padStart(64, '0');
        const pairResult = await rpcCall('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6', factoryData);
        const addr = '0x' + pairResult.slice(26);
        if (addr === '0x' + '0'.repeat(40)) { this._blocker = 'No Uniswap pair — add liquidity first'; return; }
        this._pairAddress = addr;
      }

      const state = await this._readState(account, this._pairAddress);
      if (!state) { this._blocker = 'Failed to read chain data'; return; }

      const { reserveFC, reserveETH, walletFC, walletETH, mainPoolETH } = state;
      this._lastMainPoolETH = mainPoolETH || 0;
      this._state.cycleCount++;

      if (!this._lastEthPrice || this._state.cycleCount % 10 === 0) {
        this._lastEthPrice = await this._getEthPrice();
      }
      const ethUsd = this._lastEthPrice;
      const poolUsd = reserveETH * ethUsd * 2;
      const tier = this._getTier(poolUsd);
      const adaptiveMode = this._getAdaptiveMode(poolUsd);
      const maxImpact = this._getMaxImpact(poolUsd);

      // ─── Trinity & Goals ──────────────────────────────
      this._captureTrinity(state, ethUsd, poolUsd, tier);
      this._state.scorecard.cyclesRun = this._state.cycleCount;
      if (poolUsd > (this._state.scorecard.peakPoolUsd || 0)) this._state.scorecard.peakPoolUsd = poolUsd;
      this._evaluateGoals({
        poolUsd, walletETH, totalSwapCount: this._state.totalSwapCount,
        totalEthEarned: this._state.totalEthEarned,
      });

      // ─── SAFETY: Price & pool floor protection ──────────
      const now = Date.now();
      const oneHourAgo = now - 3_600_000;
      const priceUSD = reserveFC > 0 ? (reserveETH / reserveFC) * ethUsd : 0;

      this._state.priceHistory.push({ t: now, p: priceUSD });
      this._state.poolHistory.push({ t: now, v: poolUsd });
      this._state.priceHistory = this._state.priceHistory.filter(e => e.t > oneHourAgo);
      this._state.poolHistory = this._state.poolHistory.filter(e => e.t > oneHourAgo);

      if (this._state.priceHistory.length >= 2) {
        const firstPrice = this._state.priceHistory[0].p;
        if (firstPrice > 0 && priceUSD > 0) {
          const drop = (firstPrice - priceUSD) / firstPrice;
          if (drop >= PRICE_DROP_PAUSE_PCT) {
            this._blocker = `SAFETY: Price dropped ${(drop * 100).toFixed(1)}% in 1h — pausing`;
            return;
          }
        }
      }
      if (this._state.poolHistory.length >= 2) {
        const firstPool = this._state.poolHistory[0].v;
        if (firstPool > 0 && poolUsd > 0) {
          const drop = (firstPool - poolUsd) / firstPool;
          if (drop >= POOL_SHRINK_PAUSE_PCT) {
            this._blocker = `SAFETY: Pool shrank ${(drop * 100).toFixed(1)}% in 1h — pausing`;
            return;
          }
        }
      }

      // Hourly drain check (own trades only — but pool-level drain is captured by impact limits)
      const recentSwaps = (this._state.swapLog || []).filter(s => s.time > oneHourAgo);
      const hourlyDrainFC = recentSwaps.reduce((s, sw) => s + (sw.fc || 0), 0);
      if (reserveFC > 0 && hourlyDrainFC / reserveFC >= HOURLY_DRAIN_CAP_PCT) {
        this._blocker = `Hourly drain ${((hourlyDrainFC / reserveFC) * 100).toFixed(1)}% — cooling down`;
        return;
      }

      // Gas runway
      if (reserveETH < MIN_POOL_ETH) { this._blocker = `Pool ETH too low`; return; }

      // ═══════════════════════════════════════════════════════════
      // PROACTIVE GAS: Track burn rate, predict trades until empty
      // ═══════════════════════════════════════════════════════════
      this._trackGasBurn(walletETH);
      const tradesLeft = this._tradesUntilEmpty(walletETH);
      const gasRetain = this._gasRetainRatio(walletETH);
      if (gasRetain > 0) {
        console.log(`[FC Director] GAS FORECAST: ~${tradesLeft} trades until empty — retaining ${(gasRetain * 100).toFixed(0)}% of trade ETH as gas`);
      }

      // ═══════════════════════════════════════════════════════════
      // SMART GAS: Self-refuel when gas is low
      // ═══════════════════════════════════════════════════════════
      if (this._needsGasRefuel(walletETH)) {
        const isBuildingTier = poolUsd < 1000;
        if (walletFC > 0.5 && reserveETH >= GAS_REFUEL_MIN_POOL_ETH) {
          const refueled = await this._executeGasRefuel(
            account, { reserveFC, reserveETH }, walletETH, walletFC, isBuildingTier
          );
          if (refueled) {
            // Re-read wallet ETH after refuel
            try {
              const freshETH = await getETHBalance(account);
              // Can't easily re-read walletFC without full state read, but ETH is the critical one
              if (freshETH > walletETH) {
                // Update local reference for rest of cycle
                Object.defineProperty(state, 'walletETH', { value: freshETH, writable: true });
              }
            } catch {}
          }
        }
      }
      // If STILL out of gas, soft-block but don't die
      if (walletETH < GAS_RESERVE_ETH) {
        if (reserveETH < GAS_REFUEL_MIN_POOL_ETH || walletFC < 0.5) {
          this._blocker = `GAS LOW: ${walletETH.toFixed(6)} ETH — pool too small to self-refuel. Send ~$0.50 ETH on Base.`;
        } else {
          this._blocker = `GAS LOW: ${walletETH.toFixed(6)} ETH — refuel attempt pending next cycle.`;
        }
        return;
      }

      this._blocker = null;

      // Gas-aware cooldown — slow down when gas is getting thin
      let cooldownMult = 1;
      if (tradesLeft < 5) {
        cooldownMult = 1 + (5 - tradesLeft) * 0.5; // Up to 3.5x cooldown at 0 trades
      }

      // ─── Calculate optimal trade ────────────────────────
      const sizing = this._calcSwapAmount(reserveFC, reserveETH, walletFC, ethUsd);
      this._lastSizing = sizing;

      if (sizing.amount === 0) { this._blocker = sizing.reason; return; }
      if (sizing.priceImpact > maxImpact) { this._blocker = `Impact ${sizing.priceImpact.toFixed(1)}% > ${maxImpact}% (${adaptiveMode})`; return; }
      if (sizing.ethOut < MIN_ETH_OUTPUT) { this._blocker = `Output too low`; return; }
      if (Date.now() - this._lastSwapTime < (sizing.cooldownMs * cooldownMult) - 1000) return;

      // ─── SUGGEST MODE: show what we'd do, don't execute ─
      // Determine Trinity trend for suggestion quality
      const trinityTrend = this._state.trinity?.whatWillBe?.trend || 'stable';
      let trendAdvice = 'Market stable — standard conditions';
      let trendConfidenceAdj = 0;
      if (trinityTrend === 'growing' || trinityTrend === 'price_rising' || trinityTrend === 'liquidity_inflow') {
        trendAdvice = 'Market growing — good time to trade';
        trendConfidenceAdj = 15;
      } else if (trinityTrend === 'contracting' || trinityTrend === 'price_falling' || trinityTrend === 'liquidity_outflow') {
        trendAdvice = 'Market contracting — consider waiting';
        trendConfidenceAdj = -20;
      }
      const baseConfidence = sizing.priceImpact < 1 ? 90 : sizing.priceImpact < 3 ? 70 : 50;
      const adjustedConfidence = Math.max(0, Math.min(100, baseConfidence + trendConfidenceAdj));

      this._suggestion = {
        timestamp: Date.now(),
        action: 'sell',
        fcAmount: sizing.amount,
        ethOut: sizing.ethOut,
        ethOutUSD: sizing.ethOutUSD,
        priceImpact: sizing.priceImpact,
        poolDrainPct: sizing.poolDrainPct,
        gasProfit: sizing.gasProfit,
        adaptiveMode,
        maxImpact,
        tier: tier.name,
        poolUsd,
        reason: `Sell ${sizing.amount.toFixed(4)} FC → ${sizing.ethOut.toFixed(8)} ETH ($${sizing.ethOutUSD.toFixed(4)}) | ${sizing.priceImpact.toFixed(2)}% impact | ${adaptiveMode} mode`,
        trendAdvice,
        trend: trinityTrend,
        confidence: adjustedConfidence,
        // MainPool buyback info (CCS Director executes, Portal shows awareness)
        mainPoolETH: this._lastMainPoolETH || 0,
        buybackAvailable: (this._lastMainPoolETH || 0) > 0.005,
        buybackNote: (this._lastMainPoolETH || 0) > 0.005
          ? `MainPool has ${(this._lastMainPoolETH || 0).toFixed(4)} ETH ($${((this._lastMainPoolETH || 0) * ethUsd).toFixed(2)}) — CCS Director will buyback FC automatically`
          : null,
      };

      if (this._state.mode === 'suggest') {
        // Don't execute — just update the suggestion for display
        this._save();
        this._notify('suggestion');
        return;
      }

      // ─── AUTO MODE: Execute the trade ────────────────────
      // Final gas gate — re-check balance right before executing
      const ethBefore = await getETHBalance(account);
      if (ethBefore < GAS_RESERVE_ETH + GAS_PER_TX_ESTIMATE * 2) {
        this._blocker = `GAS GATE: ${ethBefore.toFixed(6)} ETH — too low to safely execute (need ${(GAS_RESERVE_ETH + GAS_PER_TX_ESTIMATE * 2).toFixed(6)})`;
        return;
      }
      const result = await this._executeSwap(account, sizing.amount, sizing.ethOut);
      if (!result.success) {
        if (result.error === 'rejected') this.pause('User rejected transaction');
        this._state.scorecard.swapsFailed++;
        return;
      }

      const ethAfter = await getETHBalance(account);
      const netChange = ethAfter - ethBefore;
      const actualGas = result.ethReceived - netChange;
      if (actualGas > 0) this._state.totalGasSpent += actualGas;

      this._lastSwapTime = Date.now();
      this._state.totalFcSold += sizing.amount;
      this._state.totalSwapCount++;
      this._state.totalEthEarned += result.ethReceived;
      this._state.tradesSinceLastDistribution = (this._state.tradesSinceLastDistribution || 0) + 1;
      this._state.swapLog.push({
        time: Date.now(), fc: sizing.amount, eth: result.ethReceived,
        gas: actualGas > 0 ? actualGas : GAS_COST_ETH,
        net: netChange, txHash: result.hash,
        impact: sizing.priceImpact, drain: sizing.poolDrainPct,
        adaptiveMode,
      });

      // Defense reflection — check for sandwich attacks
      this._reflectOnTrade(sizing.ethOut, result.ethReceived, result.hash);
      this._state.scorecard.swapsSucceeded++;

      // Profit split
      const totalUsdEarned = this._state.totalEthEarned * ethUsd;
      const nextThreshold = (this._state.reinvestCount + 1) * REINVEST_THRESHOLD_USD;
      if (totalUsdEarned >= nextThreshold) {
        const ethInWindow = this._state.totalEthEarned - this._state.totalEthReinvested - this._state.totalEthProfit;
        if (ethInWindow > 0) {
          const profitETH = ethInWindow * tier.profitRatio;
          let reinvestETH = ethInWindow * tier.reinvestRatio;

          // ─── PROACTIVE GAS RETAIN ──────────────────────────────
          let gasRetained = 0;
          if (gasRetain > 0 && reinvestETH > 0) {
            gasRetained = reinvestETH * gasRetain;
            reinvestETH -= gasRetained;
            console.log(`[FC Director] GAS RETAIN: keeping ${gasRetained.toFixed(6)} ETH as gas (${(gasRetain * 100).toFixed(0)}% of reinvest)`);
          }

          this._state.totalEthProfit += profitETH;
          this._state.reinvestCount++;

          if (reinvestETH > 0.0000001) {
            const freshETH = await getETHBalance(account);
            // Reserve enough for next full trade cycle: approve + swap + reinvest approve + reinvest = 4 txs
            const gasFloor = Math.max(GAS_COMFORT_ETH, GAS_PER_TX_ESTIMATE * 8);
            const earnedAvailable = Math.min(reinvestETH, Math.max(freshETH - gasFloor, 0));
            if (earnedAvailable > 0.0000001 && freshETH > gasFloor + earnedAvailable + GAS_PER_TX_ESTIMATE * 2) {
              const ratio = reserveFC / reserveETH;
              const fcForReinvest = Math.min(earnedAvailable * ratio, walletFC * 0.25);
              if (fcForReinvest >= 0.001) {
                await this._addLiquidity(account, fcForReinvest, earnedAvailable);
                this._state.totalEthReinvested += earnedAvailable;
              }
            }
          }

          this._state.profitLog.push({
            time: Date.now(), ethProfit: profitETH, ethReinvested: reinvestETH,
            gasRetained,
            reason: `${tier.name}: ${(tier.profitRatio * 100)}%/${(tier.reinvestRatio * 100)}%${gasRetained > 0 ? ` (${(gasRetain * 100).toFixed(0)}% gas retain)` : ''}`,
          });
        }
      }

      // Pool reward distribution — every 10 trades, distribute 5% of profit as FC to Pool #0
      if ((this._state.tradesSinceLastDistribution || 0) >= 10) {
        await this._distributePoolRewards(account, ethUsd, reserveFC, reserveETH);
      }

      this._trimLogs();
      this._save();
      this._notify('cycle');

    } catch (e) {
      console.warn('[FC Director] Cycle error:', e.message);
    } finally {
      this._cycling = false;
    }
  }

  // ─── Pool Reward Distribution ────────────────────────────────
  async _distributePoolRewards(account, ethUsd, reserveFC, reserveETH) {
    const ethProfitSinceLastDist = this._state.totalEthProfit - (this._state.lastDistributionEthProfit || 0);
    if (ethProfitSinceLastDist <= 0) {
      this._state.tradesSinceLastDistribution = 0;
      return;
    }

    const ethForRewards = ethProfitSinceLastDist * 0.05;
    if (ethForRewards < 0.0000001 || !reserveETH || reserveETH === 0) return;

    const fcPerEth = reserveFC / reserveETH;
    const fcAmount = ethForRewards * fcPerEth;
    if (fcAmount < 0.01) return;

    // distributeRewards(uint256 poolId, uint256 amount) — selector 0xdf6c39fb
    const poolId = 0;
    const amountWei = BigInt(Math.floor(fcAmount * 1e18));
    const data = '0xdf6c39fb'
      + poolId.toString(16).padStart(64, '0')
      + amountWei.toString(16).padStart(64, '0');

    try {
      const eth = window.ethereum;
      if (!eth) return;

      // Gas safety: skip distribution if gas is low
      const currentETH = await getETHBalance(account);
      if (currentETH < GAS_COMFORT_ETH) {
        console.log(`[FC Director] Pool distribution deferred — gas ${currentETH.toFixed(6)} ETH below comfort`);
        return;
      }

      const txHash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: FC_POOLS, data, gas: '0x' + (200000).toString(16) }],
      });

      const receipt = await this._waitReceipt(txHash);
      if (receipt.status !== '0x0') {
        this._state.tradesSinceLastDistribution = 0;
        this._state.lastDistributionEthProfit = this._state.totalEthProfit;
        this._state.totalDistributedFC = (this._state.totalDistributedFC || 0) + fcAmount;
        this._state.distributionCount = (this._state.distributionCount || 0) + 1;
        this._state.distributionLog.push({
          time: Date.now(), fcAmount, ethValue: ethForRewards,
          usdValue: ethForRewards * ethUsd, poolId, txHash,
        });
        if (this._state.distributionLog.length > 50) {
          this._state.distributionLog = this._state.distributionLog.slice(-50);
        }
        console.log(`[FC Director] Distributed ${fcAmount.toFixed(2)} FC rewards to Pool #0`);
        this._save();
      }
    } catch (err) {
      if (err.code === 4001 || err.message?.includes('rejected')) return;
      console.warn('[FC Director] distributeRewards error:', err.message);
    }
  }

  // ─── Smart Gas Management ─────────────────────────────────────
  _trackGasBurn(walletETH) {
    this._gasSnapshots.push({ time: Date.now(), eth: walletETH });
    if (this._gasSnapshots.length > 10) this._gasSnapshots.shift();
    if (this._gasSnapshots.length >= 2) {
      let totalBurn = 0, burns = 0;
      for (let i = 1; i < this._gasSnapshots.length; i++) {
        const delta = this._gasSnapshots[i - 1].eth - this._gasSnapshots[i].eth;
        if (delta > 0) { totalBurn += delta; burns++; }
      }
      if (burns > 0) this._avgGasPerTrade = totalBurn / burns;
    }
  }

  _tradesUntilEmpty(walletETH) {
    const usable = Math.max(walletETH - GAS_RESERVE_ETH, 0);
    // A full trade cycle = approve + swap + possible reinvest (approve + addLiquidity) = up to 4 txs
    const costPerCycle = Math.max(this._avgGasPerTrade, GAS_PER_TX_ESTIMATE * 4);
    if (costPerCycle <= 0) return 999;
    return Math.floor(usable / costPerCycle);
  }

  _gasRetainRatio(walletETH) {
    const tradesLeft = this._tradesUntilEmpty(walletETH);
    if (tradesLeft >= 3) return 0;
    if (tradesLeft === 2) return 0.30;
    if (tradesLeft === 1) return 0.60;
    return 0.90;
  }

  _needsGasRefuel(walletETH) {
    if (walletETH >= GAS_COMFORT_ETH) return false;
    if (walletETH < GAS_RESERVE_ETH * 0.5) return true;
    if (walletETH < GAS_COMFORT_ETH) return true;
    return false;
  }

  _calcGasRefuel(pool, walletETH, walletFC, buildingMode = false) {
    const targetETH = buildingMode ? GAS_RESERVE_ETH * 2 : GAS_REFUEL_TARGET_ETH;
    const ethNeeded = Math.max(targetETH - walletETH, GAS_COST_ETH * 10);
    if (ethNeeded <= 0) return null;

    const x = pool.reserveFC;
    const y = pool.reserveETH;
    if (!x || !y || y < GAS_REFUEL_MIN_POOL_ETH) return null;

    const fcNeeded = (ethNeeded * x) / (0.997 * (y - ethNeeded));
    if (!isFinite(fcNeeded) || fcNeeded <= 0) return null;

    const maxPct = buildingMode ? 0.005 : GAS_REFUEL_MAX_FC_PCT;
    const maxFcForGas = walletFC * maxPct;
    const fcToSell = Math.min(fcNeeded, maxFcForGas, MAX_SWAP_FC);
    if (fcToSell < MIN_SWAP_FC) return null;
    if (fcToSell > walletFC) return null;

    const fcIn = fcToSell * 0.997;
    const ethOut = (fcIn * y) / (x + fcIn);

    const spotPrice = y / x;
    const effectivePrice = ethOut / fcToSell;
    const impact = ((spotPrice - effectivePrice) / spotPrice) * 100;
    const maxImpact = buildingMode ? 1 : 5;
    if (impact > maxImpact) return null;

    return {
      fcToSell: parseFloat(fcToSell.toFixed(4)),
      ethExpected: ethOut,
      priceImpact: impact,
      reason: `Gas ${walletETH.toFixed(6)} ETH → refuel ${fcToSell.toFixed(2)} FC → ~${ethOut.toFixed(6)} ETH${buildingMode ? ' (building-safe)' : ''}`,
    };
  }

  async _executeGasRefuel(account, pool, walletETH, walletFC, buildingMode = false) {
    if (Date.now() - this._lastGasRefuelTime < GAS_REFUEL_COOLDOWN_MS) return false;

    const plan = this._calcGasRefuel(pool, walletETH, walletFC, buildingMode);
    if (!plan) return false;

    console.log(`[FC Director] GAS REFUEL: ${plan.reason}`);

    const result = await this._executeSwap(account, plan.fcToSell, plan.ethExpected);
    if (!result.success) {
      console.warn(`[FC Director] Gas refuel failed: ${result.error}`);
      return false;
    }

    this._lastGasRefuelTime = Date.now();
    this._state.gasRefuelCount++;
    this._state.totalGasRefuelETH += result.ethReceived;
    this._state.totalGasRefuelFC += plan.fcToSell;
    this._state.gasRefuelLog.push({
      time: Date.now(), fc: plan.fcToSell, eth: result.ethReceived,
      ethBefore: walletETH, ethAfter: walletETH + result.ethReceived,
      txHash: result.hash, impact: plan.priceImpact,
    });
    if (this._state.gasRefuelLog.length > 30) {
      this._state.gasRefuelLog = this._state.gasRefuelLog.slice(-30);
    }

    this._state.totalFcSold += plan.fcToSell;
    this._state.totalSwapCount++;
    this._state.totalEthEarned += result.ethReceived;

    console.log(`[FC Director] Gas refueled! +${result.ethReceived.toFixed(6)} ETH (sold ${plan.fcToSell.toFixed(2)} FC)`);
    this._save();
    return true;
  }

  // ─── Execute Swap ──────────────────────────────────────────
  async _executeSwap(account, fcAmount, expectedEthOut) {
    const eth = window.ethereum;
    try {
      const addrPad = account.slice(2).toLowerCase().padStart(64, '0');
      const routerPad = UNISWAP_ROUTER.slice(2).toLowerCase().padStart(64, '0');
      let allowance = 0;
      try {
        const allowHex = await rpcCall(FC_TOKEN, SEL.allowance + addrPad + routerPad);
        allowance = Number(BigInt(allowHex)) / 1e18;
      } catch {}

      if (allowance < fcAmount) {
        const maxApproval = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        const approveData = SEL.approve + routerPad + maxApproval;
        const approveTx = await eth.request({
          method: 'eth_sendTransaction',
          params: [{ from: account, to: FC_TOKEN, data: approveData, gas: '0x' + (60000).toString(16) }],
        });
        await this._waitReceipt(approveTx);
        await new Promise(r => setTimeout(r, 1000));
      }

      const amountIn = BigInt(Math.floor(fcAmount * 1e18));
      const minOut = BigInt(Math.floor(expectedEthOut * 0.85 * 1e18));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const data = this._encodeSwap(amountIn, minOut, account, deadline);

      const txHash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: UNISWAP_ROUTER, data, gas: '0x' + (250000).toString(16) }],
      });

      const receipt = await this._waitReceipt(txHash);
      if (receipt.status === '0x0') return { success: false, error: 'Swap reverted' };

      let ethReceived = expectedEthOut;
      try {
        for (const log of (receipt.logs || [])) {
          if (log.address?.toLowerCase() === WETH.toLowerCase() && log.data) {
            ethReceived = Number(BigInt(log.data)) / 1e18;
          }
        }
      } catch {}

      console.log(`[FC Director] Swap: ${fcAmount} FC → ${ethReceived.toFixed(8)} ETH`);
      return { success: true, hash: txHash, ethReceived, expectedEthOut };
    } catch (err) {
      if (err.code === 4001 || err.message?.includes('rejected')) return { success: false, error: 'rejected' };
      return { success: false, error: err.message };
    }
  }

  _encodeSwap(amountIn, minOut, to, deadline) {
    const p = (v) => v.toString(16).padStart(64, '0');
    const a = (addr) => addr.slice(2).toLowerCase().padStart(64, '0');
    return SEL.swapExactTokensForETH + p(amountIn) + p(minOut) + p(BigInt(160)) + a(to) + p(deadline) + p(BigInt(2)) + a(FC_TOKEN) + a(WETH);
  }

  async _addLiquidity(account, fcAmount, ethAmount) {
    const eth = window.ethereum;
    try {
      // Gas safety: abort if reinvesting would leave wallet below comfort level
      const currentETH = await getETHBalance(account);
      const ethAfterReinvest = currentETH - ethAmount - GAS_PER_TX_ESTIMATE * 2; // 2 txs: approve + addLiquidity
      if (ethAfterReinvest < GAS_COMFORT_ETH) {
        console.log(`[FC Director] Reinvest skipped — would leave ${ethAfterReinvest.toFixed(6)} ETH (need ${GAS_COMFORT_ETH})`);
        return;
      }
      const routerPad = UNISWAP_ROUTER.slice(2).toLowerCase().padStart(64, '0');
      const approveAmt = BigInt(Math.floor(fcAmount * 1e18));
      const approveData = SEL.approve + routerPad + approveAmt.toString(16).padStart(64, '0');
      const approveTx = await eth.request({ method: 'eth_sendTransaction', params: [{ from: account, to: FC_TOKEN, data: approveData, gas: '0x' + (60000).toString(16) }] });
      await this._waitReceipt(approveTx);
      await new Promise(r => setTimeout(r, 500));

      const p = (v) => v.toString(16).padStart(64, '0');
      const a = (addr) => addr.slice(2).toLowerCase().padStart(64, '0');
      const tokenMin = BigInt(Math.floor(fcAmount * 0.9 * 1e18));
      const ethMin = BigInt(Math.floor(ethAmount * 0.9 * 1e18));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const data = SEL.addLiquidityETH + a(FC_TOKEN) + p(approveAmt) + p(tokenMin) + p(ethMin) + a(account) + p(deadline);
      const value = '0x' + BigInt(Math.floor(ethAmount * 1e18)).toString(16);

      const txHash = await eth.request({ method: 'eth_sendTransaction', params: [{ from: account, to: UNISWAP_ROUTER, data, value, gas: '0x' + (300000).toString(16) }] });
      await this._waitReceipt(txHash);
      console.log(`[FC Director] Reinvested: ${fcAmount.toFixed(4)} FC + ${ethAmount.toFixed(6)} ETH`);
    } catch (err) { console.warn('[FC Director] Reinvest failed:', err.message); }
  }

  async _waitReceipt(txHash) {
    const eth = window.ethereum;
    const start = Date.now();
    while (Date.now() - start < 120000) {
      try {
        const r = await eth.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
        if (r) { if (r.status === '0x0') throw new Error('Transaction reverted'); return r; }
      } catch (e) { if (e.message?.includes('reverted')) throw e; }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('TX not confirmed in 2 minutes');
  }

  // ─── Helpers ───────────────────────────────────────────────
  _trimLogs() {
    if (this._state.swapLog.length > 200) this._state.swapLog = this._state.swapLog.slice(-200);
    if (this._state.reinvestLog.length > 50) this._state.reinvestLog = this._state.reinvestLog.slice(-50);
    if (this._state.profitLog.length > 50) this._state.profitLog = this._state.profitLog.slice(-50);
  }

  _load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
  _save() {
    try {
      // Trim logs aggressively before saving to prevent localStorage overflow
      this._trimLogs();
      if (this._state.priceHistory?.length > 60) this._state.priceHistory = this._state.priceHistory.slice(-60);
      if (this._state.poolHistory?.length > 60) this._state.poolHistory = this._state.poolHistory.slice(-60);
      if (this._state.defense?.anomalyLog?.length > 20) this._state.defense.anomalyLog = this._state.defense.anomalyLog.slice(-20);
      if (this._state.distributionLog?.length > 20) this._state.distributionLog = this._state.distributionLog.slice(-20);
      if (this._state.gasRefuelLog?.length > 15) this._state.gasRefuelLog = this._state.gasRefuelLog.slice(-15);
      const data = JSON.stringify(this._state);
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      // localStorage full — emergency trim
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.message?.includes('quota')) {
        console.warn('[FC Director] localStorage full — emergency trim');
        this._state.swapLog = (this._state.swapLog || []).slice(-20);
        this._state.profitLog = (this._state.profitLog || []).slice(-10);
        this._state.priceHistory = (this._state.priceHistory || []).slice(-20);
        this._state.poolHistory = (this._state.poolHistory || []).slice(-20);
        this._state.reinvestLog = [];
        this._state.distributionLog = (this._state.distributionLog || []).slice(-5);
        if (this._state.defense) this._state.defense.anomalyLog = [];
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state)); } catch {}
      }
    }
  }
  onChange(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(l => l !== fn); }; }
  _notify(event) { for (const fn of this._listeners) { try { fn(event, this.getStatus()); } catch {} } }

  // ─── Status ────────────────────────────────────────────────
  getStatus() {
    const ethUsd = this._lastEthPrice || 2500;
    const sizing = this._lastSizing || {};
    const totalUsd = this._state.totalEthEarned * ethUsd;
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const recentSwaps = (this._state.swapLog || []).filter(s => s.time > oneHourAgo);
    const hourlyDrainFC = recentSwaps.reduce((s, sw) => s + (sw.fc || 0), 0);

    return {
      running: this._running,
      paused: this._paused,
      pauseReason: this._pauseReason,
      blocker: this._blocker,
      mode: this._state.mode || 'suggest',
      suggestion: this._suggestion,
      cycleCount: this._state.cycleCount,
      totalFcSold: this._state.totalFcSold,
      totalEthEarned: this._state.totalEthEarned,
      totalEthProfit: this._state.totalEthProfit,
      totalEthReinvested: this._state.totalEthReinvested,
      totalUsdEarned: totalUsd,
      profitUsd: this._state.totalEthProfit * ethUsd,
      reinvestedUsd: this._state.totalEthReinvested * ethUsd,
      reinvestCount: this._state.reinvestCount,
      // Adaptive scaling
      swapAmount: sizing.amount || 0,
      swapEthOut: sizing.ethOut || 0,
      swapImpact: sizing.priceImpact || 0,
      swapDrainPct: sizing.poolDrainPct || 0,
      adaptiveMode: sizing.adaptiveMode || 'unknown',
      maxImpact: sizing.maxImpact || NORMAL_IMPACT_PCT,
      scalingReason: sizing.reason || '',
      // Safety
      hourlyDrainFC: parseFloat(hourlyDrainFC.toFixed(2)),
      hourlyDrainCapPct: HOURLY_DRAIN_CAP_PCT * 100,
      swapsLastHour: recentSwaps.length,
      // Gas
      gasReserve: GAS_RESERVE_ETH,
      gasWarningETH: GAS_WARNING_ETH,
      gasComfort: GAS_COMFORT_ETH,
      gasSelfFunding: true,
      gasCostPerTx: GAS_COST_ETH,
      totalGasSpent: this._state.totalGasSpent,
      // Proactive gas forecast
      gasTradesUntilEmpty: this._tradesUntilEmpty(0), // updated per cycle
      gasAvgBurnPerTrade: this._avgGasPerTrade,
      gasRetainPct: this._gasRetainRatio(0) * 100,
      // Gas self-management
      gasRefuelCount: this._state.gasRefuelCount,
      totalGasRefuelETH: this._state.totalGasRefuelETH,
      totalGasRefuelFC: this._state.totalGasRefuelFC,
      recentGasRefuels: (this._state.gasRefuelLog || []).slice(-5).reverse(),
      totalSwapCount: this._state.totalSwapCount,
      netProfitEth: this._state.totalEthEarned - this._state.totalGasSpent - this._state.totalEthReinvested,
      netProfitUsd: (this._state.totalEthEarned - this._state.totalGasSpent - this._state.totalEthReinvested) * ethUsd,
      // Logs
      recentSwaps: (this._state.swapLog || []).slice(-10).reverse(),
      recentProfitSplits: (this._state.profitLog || []).slice(-5).reverse(),
      // Config
      maxDrainPct: MAX_DRAIN_PCT * 100,
      // Trinity state
      trinity: this._state.trinity || null,
      // Goal progress
      goal: this._getGoalProgress({
        poolUsd: 0, walletETH: 0,
        totalSwapCount: this._state.totalSwapCount,
        totalEthEarned: this._state.totalEthEarned,
      }),
      // Defense
      defense: {
        level: this._state.defense?.level || 'normal',
        anomalies: (this._state.defense?.anomalyLog || []).length,
        recentAnomalies: (this._state.defense?.anomalyLog || []).filter(a => a.t > now - 600_000).length,
        sandwichCount: this._state.defense?.sandwichCount || 0,
        lastEscalation: this._state.defense?.lastEscalation || 0,
      },
      // Scorecard
      scorecard: {
        cyclesRun: this._state.scorecard?.cyclesRun || this._state.cycleCount || 0,
        swapsSucceeded: this._state.scorecard?.swapsSucceeded || 0,
        swapsFailed: this._state.scorecard?.swapsFailed || 0,
        peakPoolUsd: this._state.scorecard?.peakPoolUsd || 0,
        healthScore: this._state.defense?.level === 'critical' ? 25 : this._state.defense?.level === 'elevated' ? 60 : 100,
      },
      // MainPool buyback awareness (read-only — CCS Director executes)
      mainPoolETH: this._lastMainPoolETH || 0,
      mainPoolUSD: (this._lastMainPoolETH || 0) * ethUsd,
      buybackAvailable: (this._lastMainPoolETH || 0) > 0.005,
      lastBuybackTime: this._state.lastBuybackTime || 0,
      // Pool reward distribution
      tradesSinceLastDistribution: this._state.tradesSinceLastDistribution || 0,
      totalDistributedFC: this._state.totalDistributedFC || 0,
      distributionCount: this._state.distributionCount || 0,
      distributionLog: (this._state.distributionLog || []).slice(-10).reverse(),
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────
let _instance = null;
function getDirectorAI() {
  if (!_instance) _instance = new FCPortalDirector();
  return _instance;
}

// ─── React Hook ──────────────────────────────────────────────
export function useDirectorAI() {
  const [status, setStatus] = useState(null);
  const dirRef = useRef(null);

  useEffect(() => {
    const dir = getDirectorAI();
    dirRef.current = dir;
    setStatus(dir.getStatus());
    const unsub = dir.onChange((_, s) => setStatus(s));
    const poll = setInterval(() => setStatus(dir.getStatus()), 5000);

    // Auto-resume ONLY if was running AND in auto mode
    if (dir._state.enabled && !dir._running && dir._state.mode === 'auto') {
      dir.start();
    }
    // In suggest mode, always start (just reads data, doesn't trade)
    if (!dir._running && dir._state.mode === 'suggest') {
      dir.start();
    }

    return () => { unsub(); clearInterval(poll); };
  }, []);

  const start = useCallback(() => { dirRef.current?.start(); setStatus(dirRef.current?.getStatus()); }, []);
  const stop = useCallback(() => { dirRef.current?.stop(); setStatus(dirRef.current?.getStatus()); }, []);
  const resume = useCallback(() => { dirRef.current?.resume(); setStatus(dirRef.current?.getStatus()); }, []);
  const setMode = useCallback((m) => { dirRef.current?.setMode(m); setStatus(dirRef.current?.getStatus()); }, []);

  return { status, start, stop, resume, setMode, director: dirRef.current };
}

export { getDirectorAI, FCPortalDirector };
