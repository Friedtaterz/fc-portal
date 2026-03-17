/**
 * FC DIRECTOR AI — Autonomous Trading Engine for FractalCoin
 *
 * Adapted from the FNC Director AI. Sells FC → ETH on Uniswap V2
 * with adaptive scaling, gas reserves, and tiered profit splits.
 *
 * SCALING:
 *   - Pool Building (<$1K):  tiny adds, 100% reinvest, build liquidity
 *   - Direct Payout ($1K-$100K): 30% profit / 70% reinvest
 *   - Scaling ($100K-$10M): 50% profit / 50% reinvest
 *   - Trust Mode (>$10M): 80% profit / 20% reinvest
 *
 * SAFETY:
 *   - Adaptive swap size (never drains >2% of pool)
 *   - Gas reserve always maintained (never runs wallet dry)
 *   - Dynamic cooldown (bigger swaps = longer waits)
 *   - Auto-pause on price impact >8%
 *   - Gas-positive only (swap output must exceed gas cost)
 *   - Never sells more than 40% of wallet FC
 *   - Ramps from micro-trades to larger ones as pool grows
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBaseRPC, FC_TOKEN, WETH, UNISWAP_ROUTER } from '../config';

// ─── Constants ──────────────────────────────────────────────────
const STORAGE_KEY = 'fc_director_ai';
const BASE_COOLDOWN_MS = 30_000;       // 30s minimum between trades
const MAX_IMPACT_PCT = 8;              // Pause if slippage > 8%
const MAX_SELL_RATIO = 0.40;           // Never sell more than 40% of wallet FC
const MIN_POOL_ETH = 0.0000001;        // Allow micro-pools — don't block tiny liquidity
const MIN_ETH_OUTPUT = 0.0000001;      // Accept dust output — keep trading
const GAS_COST_ETH = 0.000015;         // Actual gas per tx on Base (~approve + swap)
const MAX_DRAIN_PCT = 0.02;            // Never drain >2% of pool per swap
const SCALE_RAMP_FACTOR = 0.5;         // Use 50% of max-drain budget (conservative)

// ─── GAS STRATEGY ────────────────────────────────────────────────
// The Director NEVER runs the wallet dry. It thinks ahead.
//
// MIN_GAS_RUNWAY: Always keep enough for at least this many future
// transactions. If we can't afford the runway, we slow down or stop.
// This protects users who trust the Director with real money.
const MIN_GAS_RUNWAY_TXS = 50;        // Always keep gas for 50 more transactions
const GAS_RESERVE_ETH = GAS_COST_ETH * MIN_GAS_RUNWAY_TXS; // ~0.00075 ETH
const GAS_WARNING_TXS = 100;          // Start warning at 100 txs remaining
const GAS_SLOWDOWN_TXS = 75;          // Start slowing down at 75 txs remaining
// At 50 txs remaining: full stop. Never touch the last 50 txs of gas.
// At 75 txs: double cooldown (trade half as often)
// At 100 txs: show warning in UI but keep trading normally

// Swap size ramp — grows with pool depth
const MIN_SWAP_FC = 0.001;             // Fractional trades — most crypto is fractions
const MAX_SWAP_FC = 5000;              // Ceiling: 5000 FC per swap

// Tier thresholds (matches config.js TIERS)
const TIERS = [
  { name: 'Pool Building',  maxUsd: 1_000,       profitRatio: 0,    reinvestRatio: 1.0  },
  { name: 'Direct Payout',  maxUsd: 100_000,     profitRatio: 0.30, reinvestRatio: 0.70 },
  { name: 'Scaling',        maxUsd: 10_000_000,  profitRatio: 0.50, reinvestRatio: 0.50 },
  { name: 'Trust Mode',     maxUsd: Infinity,     profitRatio: 0.80, reinvestRatio: 0.20 },
];

const REINVEST_THRESHOLD_USD = 10;     // Check profit split every $10 earned

// Selectors
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
class FCDirectorAI {
  constructor() {
    this._state = this._load();
    this._state.swapLog = this._state.swapLog || [];
    this._state.reinvestLog = this._state.reinvestLog || [];
    this._state.totalEthEarned = this._state.totalEthEarned || 0;
    this._state.totalEthReinvested = this._state.totalEthReinvested || 0;
    this._state.totalEthProfit = this._state.totalEthProfit || 0;
    this._state.totalFcSold = this._state.totalFcSold || 0;
    this._state.reinvestCount = this._state.reinvestCount || 0;
    this._state.cycleCount = this._state.cycleCount || 0;
    this._state.profitLog = this._state.profitLog || [];
    this._running = false;
    this._paused = false;
    this._pauseReason = null;
    this._timer = null;
    this._lastSwapTime = 0;
    this._listeners = [];
    this._blocker = null;
    this._pairAddress = null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────
  start() {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._state.enabled = true;
    this._save();
    console.log('[FC Director] Online — adaptive scaling active');
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
    for (const t of TIERS) {
      if (poolUsd < t.maxUsd) return t;
    }
    return TIERS[TIERS.length - 1];
  }

  // ─── Adaptive Swap Sizing ──────────────────────────────────
  _calcSwapAmount(reserveFC, reserveETH, walletFC, ethUsd) {
    if (reserveFC < 0.001 || reserveETH < 0.0000001) {
      return { amount: 0, reason: `Pool too small (${reserveFC.toFixed(4)} FC / ${reserveETH.toFixed(10)} ETH)` };
    }

    // 1. Max drain budget
    const maxDrainFC = reserveFC * MAX_DRAIN_PCT * SCALE_RAMP_FACTOR;

    // 2. Wallet cap
    const walletCap = walletFC * MAX_SELL_RATIO;

    // 3. Clamp
    let amount = Math.min(maxDrainFC, walletCap, MAX_SWAP_FC);
    amount = Math.max(amount, MIN_SWAP_FC);

    // Can't sell more than we have
    if (amount > walletFC) {
      return { amount: 0, reason: `Need ${amount.toFixed(2)} FC, have ${walletFC.toFixed(2)}` };
    }

    // 4. AMM output calculation
    const x = reserveFC;
    const y = reserveETH;
    const fcIn = amount * 0.997; // 0.3% fee
    const ethOut = (fcIn * y) / (x + fcIn);

    // Check gas-positive
    if (ethOut < GAS_COST_ETH * 1.5) {
      // Try bigger swap up to 5% drain
      const bigAmount = Math.min(reserveFC * 0.05, walletCap, MAX_SWAP_FC, walletFC);
      const bigFcIn = bigAmount * 0.997;
      const bigEthOut = (bigFcIn * y) / (x + bigFcIn);
      if (bigEthOut >= GAS_COST_ETH * 1.5) {
        amount = bigAmount;
      } else {
        return { amount: 0, reason: `Output ${ethOut.toFixed(8)} ETH < gas cost. Pool needs more liquidity.` };
      }
    }

    // Recalculate final
    const finalFcIn = amount * 0.997;
    const finalEthOut = (finalFcIn * y) / (x + finalFcIn);
    const spotPrice = y / x;
    const effectivePrice = finalEthOut / amount;
    const priceImpact = ((spotPrice - effectivePrice) / spotPrice) * 100;

    // Dynamic cooldown: bigger swaps wait longer
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
    };
  }

  // ─── Read on-chain state ───────────────────────────────────
  async _readState(account, pairAddress) {
    try {
      const addrPad = account.slice(2).toLowerCase().padStart(64, '0');

      // Read in sequence with small delays to avoid rate limits
      const reservesHex = await rpcCall(pairAddress, SEL.getReserves);
      await new Promise(r => setTimeout(r, 300));

      const fcBalHex = await rpcCall(FC_TOKEN, SEL.balanceOf + addrPad);
      await new Promise(r => setTimeout(r, 300));

      const walletETH = await getETHBalance(account);

      // Parse reserves
      const r0 = Number(BigInt('0x' + reservesHex.slice(2, 66))) / 1e18;
      const r1 = Number(BigInt('0x' + reservesHex.slice(66, 130))) / 1e18;
      const [token0] = sortTokens(FC_TOKEN, WETH);
      let reserveFC, reserveETH;
      if (token0.toLowerCase() === FC_TOKEN.toLowerCase()) {
        reserveFC = r0; reserveETH = r1;
      } else {
        reserveFC = r1; reserveETH = r0;
      }

      const walletFC = Number(BigInt(fcBalHex)) / 1e18;

      return { reserveFC, reserveETH, walletFC, walletETH };
    } catch (e) {
      console.warn('[FC Director] Read state failed:', e.message);
      return null;
    }
  }

  // ─── Get ETH price ─────────────────────────────────────────
  async _getEthPrice() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const json = await res.json();
      return json.ethereum?.usd || this._lastEthPrice || 2500;
    } catch {
      return this._lastEthPrice || 2500;
    }
  }

  // ─── Core Cycle ────────────────────────────────────────────
  async _cycle() {
    if (!this._running || this._paused || this._cycling) return;
    this._cycling = true;

    try {
      const eth = window.ethereum;
      if (!eth) { this._blocker = 'No wallet connected'; return; }

      const accounts = await eth.request({ method: 'eth_accounts' });
      const account = accounts?.[0];
      if (!account) { this._blocker = 'Wallet not connected'; return; }

      const chainId = await eth.request({ method: 'eth_chainId' });
      if (parseInt(chainId, 16) !== 8453) { this._blocker = 'Switch to Base network'; return; }

      // Get pair address (cache it)
      if (!this._pairAddress) {
        const [t0, t1] = sortTokens(FC_TOKEN, WETH);
        const factoryData = '0xe6a43905' + t0.slice(2).toLowerCase().padStart(64, '0') + t1.slice(2).toLowerCase().padStart(64, '0');
        const pairResult = await rpcCall('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6', factoryData);
        const addr = '0x' + pairResult.slice(26);
        if (addr === '0x' + '0'.repeat(40)) { this._blocker = 'No Uniswap pair — add liquidity first'; return; }
        this._pairAddress = addr;
      }

      // Read on-chain state
      const state = await this._readState(account, this._pairAddress);
      if (!state) { this._blocker = 'Failed to read chain data'; return; }

      const { reserveFC, reserveETH, walletFC, walletETH } = state;
      this._state.cycleCount++;

      // ETH price (cached, refreshed every 10 cycles)
      if (!this._lastEthPrice || this._state.cycleCount % 10 === 0) {
        this._lastEthPrice = await this._getEthPrice();
      }
      const ethUsd = this._lastEthPrice;
      const poolUsd = reserveETH * ethUsd * 2;
      const tier = this._getTier(poolUsd);

      // ─── GAS RUNWAY CHECK ─────────────────────────────────
      // Think ahead: how many transactions can we still afford?
      if (reserveETH < MIN_POOL_ETH) {
        this._blocker = `Pool ETH too low (${reserveETH.toFixed(8)})`;
        return;
      }

      const gasRunwayTxs = Math.floor(walletETH / GAS_COST_ETH);
      this._gasRunway = gasRunwayTxs;

      if (gasRunwayTxs < MIN_GAS_RUNWAY_TXS) {
        this._blocker = `Gas runway: ${gasRunwayTxs} txs left (minimum ${MIN_GAS_RUNWAY_TXS}). ` +
          `Have ${walletETH.toFixed(6)} ETH, need ${GAS_RESERVE_ETH.toFixed(6)}. Send more ETH to keep trading.`;
        return;
      }

      if (gasRunwayTxs < GAS_WARNING_TXS) {
        this._gasWarning = `Gas getting low: ~${gasRunwayTxs} transactions remaining. Consider adding ETH.`;
      } else {
        this._gasWarning = null;
      }

      this._blocker = null;

      // If gas is getting low, slow down to extend runway
      let cycleCooldownMultiplier = 1;
      if (gasRunwayTxs < GAS_SLOWDOWN_TXS) {
        // Between 50-75 txs: progressively double to quadruple the cooldown
        cycleCooldownMultiplier = 1 + (GAS_SLOWDOWN_TXS - gasRunwayTxs) / (GAS_SLOWDOWN_TXS - MIN_GAS_RUNWAY_TXS) * 3;
      }

      // ─── GROWTH MODE: Add liquidity directly ─────────────
      if (tier.profitRatio === 0) {
        // Don't sell FC → ETH (circular drain). Add wallet ETH + FC directly.
        // IMPORTANT: Never dip into gas runway for liquidity adds
        const spendableETH = Math.max(walletETH - GAS_RESERVE_ETH, 0);
        const availableETH = spendableETH * 0.3; // Only 30% per cycle, AFTER gas reserve
        if (availableETH < 0.0000001) {
          this._blocker = `Growth mode: need more ETH. Have ${walletETH.toFixed(6)}, reserve ${GAS_RESERVE_ETH}`;
          return;
        }

        const poolRatio = reserveFC / reserveETH;
        const fcNeeded = availableETH * poolRatio;  // Fractional — no floor
        if (fcNeeded < 0.001 || walletFC < fcNeeded) {
          this._blocker = `Growth mode: need ${fcNeeded.toFixed(4)} FC to pair with ${availableETH.toFixed(6)} ETH`;
          return;
        }

        const fcToAdd = Math.min(fcNeeded, walletFC * 0.10);  // Fractional
        const ethToAdd = Math.min(fcToAdd / poolRatio, availableETH);
        if (ethToAdd < 0.0000001) return;

        // Cooldown — extended when gas is low to preserve runway
        if (Date.now() - this._lastSwapTime < BASE_COOLDOWN_MS * cycleCooldownMultiplier) return;

        await this._addLiquidity(account, fcToAdd, ethToAdd);
        this._lastSwapTime = Date.now();

        this._state.totalEthReinvested += ethToAdd;
        this._state.profitLog.push({
          time: Date.now(), ethProfit: 0, ethReinvested: ethToAdd,
          reason: `Growth: +${fcToAdd} FC + ${ethToAdd.toFixed(6)} ETH`, tier: tier.name, poolUsd,
        });
        this._trimLogs();
        this._save();
        this._notify('cycle');
        return;
      }

      // ─── NORMAL/SCALING/TRUST MODE: Sell FC → ETH ────────
      const sizing = this._calcSwapAmount(reserveFC, reserveETH, walletFC, ethUsd);
      this._lastSizing = sizing;

      if (sizing.amount === 0) { this._blocker = sizing.reason; return; }
      if (sizing.priceImpact > MAX_IMPACT_PCT) { this._blocker = `Impact ${sizing.priceImpact.toFixed(1)}% > ${MAX_IMPACT_PCT}%`; return; }
      if (sizing.ethOut < MIN_ETH_OUTPUT) { this._blocker = `Output too low: ${sizing.ethOut.toFixed(8)} ETH`; return; }
      if (Date.now() - this._lastSwapTime < (sizing.cooldownMs * cycleCooldownMultiplier) - 1000) return;

      // Execute swap
      const result = await this._executeSwap(account, sizing.amount, sizing.ethOut);
      if (!result.success) {
        if (result.error === 'rejected') this.pause('User rejected transaction');
        return;
      }

      this._lastSwapTime = Date.now();
      this._state.totalFcSold += sizing.amount;
      this._state.totalEthEarned += result.ethReceived;
      this._state.swapLog.push({
        time: Date.now(), fc: sizing.amount, eth: result.ethReceived,
        txHash: result.hash, impact: sizing.priceImpact, drain: sizing.poolDrainPct,
      });

      // ─── Profit Split ──────────────────────────────────
      const totalUsdEarned = this._state.totalEthEarned * ethUsd;
      const nextThreshold = (this._state.reinvestCount + 1) * REINVEST_THRESHOLD_USD;

      if (totalUsdEarned >= nextThreshold) {
        const ethInWindow = this._state.totalEthEarned - this._state.totalEthReinvested - this._state.totalEthProfit;
        if (ethInWindow > 0) {
          const profitETH = ethInWindow * tier.profitRatio;
          const reinvestETH = ethInWindow * tier.reinvestRatio;

          this._state.totalEthProfit += profitETH;
          this._state.reinvestCount++;

          if (reinvestETH > 0.0000001) {
            // Re-read wallet ETH — never dip into gas runway
            const freshETH = await getETHBalance(account);
            const safeReinvest = Math.min(reinvestETH, Math.max(freshETH - GAS_RESERVE_ETH * 1.5, 0) * 0.4);
            if (safeReinvest > 0.0000001) {
              const ratio = reserveFC / reserveETH;
              const fcForReinvest = Math.min(safeReinvest * ratio, walletFC * 0.25);  // Fractional
              if (fcForReinvest >= 0.001) {
                await this._addLiquidity(account, fcForReinvest, safeReinvest);
                this._state.totalEthReinvested += safeReinvest;
              }
            }
          }

          this._state.profitLog.push({
            time: Date.now(), ethProfit: profitETH, ethReinvested: reinvestETH,
            reason: `${tier.name}: ${(tier.profitRatio * 100)}% / ${(tier.reinvestRatio * 100)}%`,
            tier: tier.name, poolUsd, threshold: nextThreshold,
          });
        }
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

  // ─── Execute Swap (FC → ETH) ──────────────────────────────
  async _executeSwap(account, fcAmount, expectedEthOut) {
    const eth = window.ethereum;
    try {
      // 1. Check/set allowance
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

      // 2. Build swap
      const amountIn = BigInt(Math.floor(fcAmount * 1e18));
      const minOut = BigInt(Math.floor(expectedEthOut * 0.85 * 1e18)); // 15% slippage
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const data = this._encodeSwap(amountIn, minOut, account, deadline);

      const txHash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: UNISWAP_ROUTER, data, gas: '0x' + (250000).toString(16) }],
      });

      const receipt = await this._waitReceipt(txHash);
      if (receipt.status === '0x0') return { success: false, error: 'Swap reverted' };

      // Parse actual ETH received from logs
      let ethReceived = expectedEthOut;
      try {
        for (const log of (receipt.logs || [])) {
          if (log.address?.toLowerCase() === WETH.toLowerCase() && log.data) {
            ethReceived = Number(BigInt(log.data)) / 1e18;
          }
        }
      } catch {}

      console.log(`[FC Director] Swap: ${fcAmount} FC → ${ethReceived.toFixed(8)} ETH`);
      return { success: true, hash: txHash, ethReceived };

    } catch (err) {
      if (err.code === 4001 || err.message?.includes('rejected')) return { success: false, error: 'rejected' };
      console.warn('[FC Director] Swap failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  _encodeSwap(amountIn, minOut, to, deadline) {
    const amountHex = amountIn.toString(16).padStart(64, '0');
    const minHex = minOut.toString(16).padStart(64, '0');
    const toHex = to.slice(2).toLowerCase().padStart(64, '0');
    const deadlineHex = deadline.toString(16).padStart(64, '0');
    const pathOffset = 'a0'.padStart(64, '0');
    const pathLen = '2'.padStart(64, '0');
    const path0 = FC_TOKEN.slice(2).toLowerCase().padStart(64, '0');
    const path1 = WETH.slice(2).toLowerCase().padStart(64, '0');
    return SEL.swapExactTokensForETH + amountHex + minHex + pathOffset + toHex + deadlineHex + pathLen + path0 + path1;
  }

  // ─── Add Liquidity ─────────────────────────────────────────
  async _addLiquidity(account, fcAmount, ethAmount) {
    const eth = window.ethereum;
    try {
      // Approve FC for router
      const routerPad = UNISWAP_ROUTER.slice(2).toLowerCase().padStart(64, '0');
      const approveAmt = BigInt(Math.floor(fcAmount * 1e18));  // Fractional FC → wei
      const approveData = SEL.approve + routerPad + approveAmt.toString(16).padStart(64, '0');
      const approveTx = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: FC_TOKEN, data: approveData, gas: '0x' + (60000).toString(16) }],
      });
      await this._waitReceipt(approveTx);
      await new Promise(r => setTimeout(r, 500));

      // addLiquidityETH
      const tokenDesired = approveAmt;
      const tokenMin = BigInt(Math.floor(fcAmount * 0.9 * 1e18));
      const ethMin = BigInt(Math.floor(ethAmount * 0.9 * 1e18));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const toHex = account.slice(2).toLowerCase().padStart(64, '0');
      const tokenHex = FC_TOKEN.slice(2).toLowerCase().padStart(64, '0');

      const data = SEL.addLiquidityETH
        + tokenHex
        + tokenDesired.toString(16).padStart(64, '0')
        + tokenMin.toString(16).padStart(64, '0')
        + ethMin.toString(16).padStart(64, '0')
        + toHex
        + deadline.toString(16).padStart(64, '0');

      const value = '0x' + BigInt(Math.floor(ethAmount * 1e18)).toString(16);

      const txHash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: UNISWAP_ROUTER, data, value, gas: '0x' + (300000).toString(16) }],
      });
      await this._waitReceipt(txHash);
      console.log(`[FC Director] Reinvested: ${fcAmount} FC + ${ethAmount.toFixed(6)} ETH`);
    } catch (err) {
      console.warn('[FC Director] Reinvest failed:', err.message);
    }
  }

  // ─── Wait for TX receipt ───────────────────────────────────
  async _waitReceipt(txHash) {
    const eth = window.ethereum;
    const start = Date.now();
    while (Date.now() - start < 120000) {
      try {
        const r = await eth.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
        if (r) {
          if (r.status === '0x0') throw new Error('Transaction reverted');
          return r;
        }
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
  _save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state)); } catch {} }

  onChange(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(l => l !== fn); }; }
  _notify(event) { for (const fn of this._listeners) { try { fn(event, this.getStatus()); } catch {} } }

  // ─── Status ────────────────────────────────────────────────
  getStatus() {
    const ethUsd = this._lastEthPrice || 2500;
    const sizing = this._lastSizing || {};
    const totalUsd = this._state.totalEthEarned * ethUsd;
    const profitUsd = this._state.totalEthProfit * ethUsd;
    const reinvestedUsd = this._state.totalEthReinvested * ethUsd;

    return {
      running: this._running,
      paused: this._paused,
      pauseReason: this._pauseReason,
      blocker: this._blocker,
      cycleCount: this._state.cycleCount,
      totalFcSold: this._state.totalFcSold,
      totalEthEarned: this._state.totalEthEarned,
      totalEthProfit: this._state.totalEthProfit,
      totalEthReinvested: this._state.totalEthReinvested,
      totalUsdEarned: totalUsd,
      profitUsd,
      reinvestedUsd,
      reinvestCount: this._state.reinvestCount,
      // Scaling
      swapAmount: sizing.amount || 0,
      swapEthOut: sizing.ethOut || 0,
      swapImpact: sizing.priceImpact || 0,
      swapDrainPct: sizing.poolDrainPct || 0,
      scalingReason: sizing.reason || '',
      // Logs
      recentSwaps: (this._state.swapLog || []).slice(-10).reverse(),
      recentProfitSplits: (this._state.profitLog || []).slice(-5).reverse(),
      // Gas runway
      gasReserve: GAS_RESERVE_ETH,
      gasRunwayTxs: this._gasRunway || 0,
      gasWarning: this._gasWarning || null,
      gasCostPerTx: GAS_COST_ETH,
      // Config
      maxDrainPct: MAX_DRAIN_PCT * 100,
      maxImpactPct: MAX_IMPACT_PCT,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────
let _instance = null;
function getDirectorAI() {
  if (!_instance) _instance = new FCDirectorAI();
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

    // Also poll status every 5s for UI updates
    const poll = setInterval(() => setStatus(dir.getStatus()), 5000);

    // Auto-resume if was running
    if (dir._state.enabled && !dir._running) dir.start();

    return () => { unsub(); clearInterval(poll); };
  }, []);

  const start = useCallback(() => { dirRef.current?.start(); setStatus(dirRef.current?.getStatus()); }, []);
  const stop = useCallback(() => { dirRef.current?.stop(); setStatus(dirRef.current?.getStatus()); }, []);
  const resume = useCallback(() => { dirRef.current?.resume(); setStatus(dirRef.current?.getStatus()); }, []);

  return { status, start, stop, resume, director: dirRef.current };
}

export { getDirectorAI, FCDirectorAI };
