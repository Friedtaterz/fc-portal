import { useState, useEffect, useCallback, useRef } from 'react';
import { getBaseRPC, FC_TOKEN, FC_POOLS, WETH, UNISWAP_FACTORY, SEL } from '../config';

// ─── RPC helper (with retry) ─────────────────────────────────
async function rpcCall(to, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
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
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
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

// ─── Uniswap V2 pair address ────────────────────────────────
function sortTokens(a, b) {
  const aL = a.toLowerCase();
  const bL = b.toLowerCase();
  return aL < bL ? [aL, bL] : [bL, aL];
}

async function getPairAddress() {
  const [token0, token1] = sortTokens(FC_TOKEN, WETH);
  const data = '0xe6a43905'
    + token0.slice(2).padStart(64, '0')
    + token1.slice(2).padStart(64, '0');
  const result = await rpcCall(UNISWAP_FACTORY, data);
  const addr = '0x' + result.slice(26);
  if (addr === '0x' + '0'.repeat(40)) return null;
  return addr;
}

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
  });

  // Keep a ref to the last good data so failed polls don't reset to 0
  const lastGood = useRef({});

  const poll = useCallback(async () => {
    try {
      // Get ETH price
      let ethUsd = lastGood.current.ethPrice || 2500;
      try {
        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const priceJson = await priceRes.json();
        if (priceJson.ethereum?.usd) ethUsd = priceJson.ethereum.usd;
      } catch {}

      await new Promise(r => setTimeout(r, 500));

      // Get pair address + reserves
      let pairAddress = lastGood.current.pairAddress || null;
      let poolReserveFC = lastGood.current.poolReserveFC || 0;
      let poolReserveETH = lastGood.current.poolReserveETH || 0;
      let fcPrice = lastGood.current.fcPrice || 0;
      let poolExists = lastGood.current.poolExists || false;

      try {
        pairAddress = await getPairAddress();
        if (pairAddress && pairAddress !== '0x' + '0'.repeat(40)) {
          await new Promise(r => setTimeout(r, 500));
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

      await new Promise(r => setTimeout(r, 500));

      // Total supply — keep last good value on failure
      let totalSupply = lastGood.current.totalSupply || 21_000_000;
      try {
        const supplyHex = await rpcCall(FC_TOKEN, SEL.totalSupply);
        totalSupply = Number(BigInt(supplyHex)) / 1e18;
      } catch {}

      // Wallet balances — keep last good value on failure
      let walletFC = lastGood.current.walletFC || 0;
      let walletETH = lastGood.current.walletETH || 0;
      if (account) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const balHex = await rpcCall(FC_TOKEN, SEL.balanceOf + account.slice(2).toLowerCase().padStart(64, '0'));
          walletFC = Number(BigInt(balHex)) / 1e18;
        } catch {}
        await new Promise(r => setTimeout(r, 500));
        try {
          walletETH = await getETHBalance(account);
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
    const interval = setInterval(poll, 60_000); // every 60s
    return () => clearInterval(interval);
  }, [poll]);

  return { ...data, refresh: poll };
}
