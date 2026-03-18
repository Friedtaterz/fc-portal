import { useState, useEffect, useCallback, useRef } from 'react';
import { getBaseRPC, FC_TOKEN, FC_POOLS, WETH, UNISWAP_FACTORY, SEL } from '../config';

// ─── RPC helper (with retry + round-robin) ──────────────────
async function rpcCall(to, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
      const res = await fetch(getBaseRPC(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      const json = await res.json();
      if (json.error) {
        if ((json.error.message?.includes('rate limit') || json.error.code === -32016) && attempt < 2) continue;
        throw new Error(json.error.message);
      }
      return json.result;
    } catch (e) {
      if (attempt === 2) throw e;
      if (!e.message?.includes('rate limit') && !e.message?.includes('1015')) throw e;
    }
  }
}

async function getETHBalance(address) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
      const res = await fetch(getBaseRPC(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      });
      const json = await res.json();
      if (json.error) {
        if (attempt < 2) continue;
        throw new Error(json.error.message);
      }
      return Number(BigInt(json.result)) / 1e18;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

// ─── Uniswap V2 pair address (cached) ──────────────────────
function sortTokens(a, b) {
  const aL = a.toLowerCase();
  const bL = b.toLowerCase();
  return aL < bL ? [aL, bL] : [bL, aL];
}

let _cachedPair = null;

async function getPairAddress() {
  if (_cachedPair) return _cachedPair;
  const [token0, token1] = sortTokens(FC_TOKEN, WETH);
  const data = '0xe6a43905'
    + token0.slice(2).padStart(64, '0')
    + token1.slice(2).padStart(64, '0');
  const result = await rpcCall(UNISWAP_FACTORY, data);
  const addr = '0x' + result.slice(26);
  if (addr === '0x' + '0'.repeat(40)) return null;
  _cachedPair = addr;
  return addr;
}

// ─── Live polling interval ──────────────────────────────────
const POLL_INTERVAL_MS = 15_000;  // 15s — live tickers, not stale data
const ETH_PRICE_INTERVAL_MS = 120_000; // Refresh ETH price every 2 min (CoinGecko rate limit)

// ─── Main hook ──────────────────────────────────────────────
export function useChainData(account) {
  const [data, setData] = useState({
    loading: true,
    fcPrice: 0,
    fcPriceUsd: 0,
    ethPrice: 2500,
    poolReserveFC: 0,
    poolReserveETH: 0,
    poolLiquidityUsd: 0,
    totalSupply: 21_000_000,
    walletFC: 0,
    walletETH: 0,
    poolExists: false,
    pairAddress: null,
    allocation: { mined: 0, deposited: 0, treasury: 0, founder: 0, burned: 0 },
    lastPollTime: 0,
  });

  // Keep a ref to the last good data so failed polls don't reset to 0
  const lastGood = useRef({});
  const lastEthPriceTime = useRef(0);

  const poll = useCallback(async () => {
    try {
      // ETH price — only refresh every 2 minutes (CoinGecko rate limits)
      let ethUsd = lastGood.current.ethPrice || 2500;
      if (Date.now() - lastEthPriceTime.current > ETH_PRICE_INTERVAL_MS) {
        try {
          const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
          const priceJson = await priceRes.json();
          if (priceJson.ethereum?.usd) {
            ethUsd = priceJson.ethereum.usd;
            lastEthPriceTime.current = Date.now();
          }
        } catch {}
      }

      // Get pair address (cached after first call)
      let pairAddress = lastGood.current.pairAddress || null;
      let poolReserveFC = lastGood.current.poolReserveFC || 0;
      let poolReserveETH = lastGood.current.poolReserveETH || 0;
      let fcPrice = lastGood.current.fcPrice || 0;
      let poolExists = lastGood.current.poolExists || false;

      try {
        pairAddress = await getPairAddress();
        if (pairAddress && pairAddress !== '0x' + '0'.repeat(40)) {
          const reserves = await rpcCall(pairAddress, SEL.getReserves);
          if (reserves && reserves !== '0x') {
            const r0 = Number(BigInt('0x' + reserves.slice(2, 66))) / 1e18;
            const r1 = Number(BigInt('0x' + reserves.slice(66, 130))) / 1e18;
            const [token0] = sortTokens(FC_TOKEN, WETH);
            if (token0 === FC_TOKEN.toLowerCase()) {
              poolReserveFC = r0;
              poolReserveETH = r1;
            } else {
              poolReserveFC = r1;
              poolReserveETH = r0;
            }
            if (poolReserveFC > 0) fcPrice = poolReserveETH / poolReserveFC;
            poolExists = poolReserveFC > 0 && poolReserveETH > 0;
          }
        }
      } catch {}

      // Allocation buckets — read storage slots 0-3 and 6 directly from FCToken
      // Slot 0: minedSupply, 1: depositMinted, 2: treasuryMinted, 3: founderMinted, 6: totalBurned
      let allocation = lastGood.current.allocation || { mined: 0, deposited: 0, treasury: 0, founder: 0, burned: 0 };
      try {
        const readSlot = async (slot) => {
          const slotHex = '0x' + slot.toString(16).padStart(64, '0');
          const res = await fetch(getBaseRPC(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getStorageAt', params: [FC_TOKEN, slotHex, 'latest'] }),
          });
          const json = await res.json();
          if (json.error) return 0;
          return Number(BigInt(json.result || '0x0')) / 1e18;
        };
        const [mined, deposited, treasury, founder, burned] = await Promise.all([
          readSlot(0), readSlot(1), readSlot(2), readSlot(3), readSlot(6),
        ]);
        allocation = { mined, deposited, treasury, founder, burned };
      } catch {}

      // Total supply
      let totalSupply = lastGood.current.totalSupply || 21_000_000;
      try {
        const supplyHex = await rpcCall(FC_TOKEN, SEL.totalSupply);
        totalSupply = Number(BigInt(supplyHex)) / 1e18;
      } catch {}

      // Wallet balances
      let walletFC = lastGood.current.walletFC || 0;
      let walletETH = lastGood.current.walletETH || 0;
      if (account) {
        try {
          const [balHex, ethBal] = await Promise.all([
            rpcCall(FC_TOKEN, SEL.balanceOf + account.slice(2).toLowerCase().padStart(64, '0')),
            getETHBalance(account),
          ]);
          walletFC = Number(BigInt(balHex)) / 1e18;
          walletETH = ethBal;
        } catch {}
      }

      const newData = {
        loading: false,
        fcPrice,
        fcPriceUsd: fcPrice * ethUsd,
        ethPrice: ethUsd,
        poolReserveFC,
        poolReserveETH,
        poolLiquidityUsd: poolReserveETH * ethUsd * 2,
        totalSupply,
        walletFC,
        walletETH,
        poolExists,
        pairAddress,
        allocation,
        lastPollTime: Date.now(),
      };

      // Save as last known good
      lastGood.current = newData;
      setData(newData);
    } catch (err) {
      console.warn('[ChainData] Poll error:', err.message);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [account]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  return { ...data, refresh: poll };
}
