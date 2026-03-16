import { useState, useEffect, useCallback } from 'react';
import { getBaseRPC, FC_TOKEN, UNISWAP_ROUTER, UNISWAP_FACTORY, WETH } from '../config';

// ─── RPC helpers (with retry + throttle) ─────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function rpcCall(to, data, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) await delay(1500 * attempt); // backoff between retries
      const res = await fetch(getBaseRPC(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      const json = await res.json();
      if (json.error) {
        if (json.error.message?.includes('rate limit') && attempt < retries - 1) continue;
        throw new Error(json.error.message);
      }
      return json.result;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      if (!e.message?.includes('rate limit')) throw e;
    }
  }
}

function encAddr(addr) { return addr.slice(2).toLowerCase().padStart(64, '0'); }
function encU256(n) { return BigInt(n).toString(16).padStart(64, '0'); }
function decU256(hex, offset = 0) {
  const start = 2 + offset * 64;
  return BigInt('0x' + (hex.slice(start, start + 64) || '0'));
}
function decAddr(hex, offset = 0) {
  const start = 2 + offset * 64;
  return '0x' + hex.slice(start + 24, start + 64);
}
function decBool(hex, offset = 0) { return Number(decU256(hex, offset)) !== 0; }

// ─── Selectors ──────────────────────────────────────────
const SEL = {
  // FC Token reads
  totalSupply:    '0x18160ddd',
  balanceOf:      '0x70a08231',
  owner:          '0x8da5cb5b',
  pair:           '0xa8aa1b31',
  exempt:         '0xf1320af2',
  allowance:      '0xdd62ed3e',
  maxTransfer:    '0x30ff6589',
  // FC Token writes (owner-only)
  ownerMint:      '0xc763b8c2',   // (address, uint256) — 50K/24h limit
  treasuryMint:   '0x52699ac8',   // (uint256) — treasury cap
  setModule:      '0xb1662d58',   // (address, bool)
  setExempt:      '0x9fde54f5',   // (address, bool)
  setPair:        '0x8187f516',   // (address)
  approve:        '0x095ea7b3',   // (address, uint256)
  // Uniswap Factory
  getPair:        '0xe6a43905',   // (tokenA, tokenB)
  createPair:     '0xc9c65396',   // (tokenA, tokenB)
  // Uniswap Router
  addLiquidityETH: '0xf305d719', // (token, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline)
  // Pair
  getReserves:    '0x0902f1ac',
};

// ─── Verification Checks ────────────────────────────────
// Each returns { pass: bool, detail: string, value?: any }

async function checkWallet(wallet) {
  if (!wallet.account) return { pass: false, detail: 'Wallet not connected' };
  if (!wallet.isBase) return { pass: false, detail: 'Not on Base network — switch networks' };
  return { pass: true, detail: `Connected: ${wallet.account.slice(0, 6)}...${wallet.account.slice(-4)}` };
}

async function checkIsOwner(wallet) {
  if (!wallet.account) return { pass: false, detail: 'Wallet not connected' };
  try {
    const result = await rpcCall(FC_TOKEN, SEL.owner);
    const owner = decAddr(result, 0);
    const isOwner = owner.toLowerCase() === wallet.account.toLowerCase();
    return {
      pass: isOwner,
      detail: isOwner ? 'You are the FC token owner' : `Owner is ${owner.slice(0, 6)}...${owner.slice(-4)} — you need the owner wallet`,
      value: owner,
    };
  } catch (e) { return { pass: false, detail: 'Failed to read owner: ' + e.message }; }
}

async function checkETHBalance(wallet) {
  if (!wallet.account || !window.ethereum) return { pass: false, detail: 'Wallet not connected' };
  try {
    const bal = await window.ethereum.request({ method: 'eth_getBalance', params: [wallet.account, 'latest'] });
    const eth = Number(BigInt(bal)) / 1e18;
    return {
      pass: eth >= 0.001,
      detail: `${eth.toFixed(6)} ETH${eth < 0.001 ? ' — need at least 0.001 ETH for gas' : ''}`,
      value: eth,
    };
  } catch (e) { return { pass: false, detail: 'Failed to read balance: ' + e.message }; }
}

async function checkTotalSupply() {
  try {
    const result = await rpcCall(FC_TOKEN, SEL.totalSupply);
    const supply = Number(decU256(result, 0)) / 1e18;
    return {
      pass: supply > 0,
      detail: supply > 0 ? `${supply.toLocaleString()} FC minted` : 'No FC tokens exist yet — need to mint',
      value: supply,
    };
  } catch (e) { return { pass: false, detail: 'Failed to read supply: ' + e.message }; }
}

async function checkOwnerFCBalance(wallet) {
  if (!wallet.account) return { pass: false, detail: 'Wallet not connected' };
  try {
    const result = await rpcCall(FC_TOKEN, SEL.balanceOf + encAddr(wallet.account));
    const bal = Number(decU256(result, 0)) / 1e18;
    return {
      pass: bal > 0,
      detail: bal > 0 ? `${bal.toLocaleString()} FC in your wallet` : 'You have 0 FC — mint tokens first',
      value: bal,
    };
  } catch (e) { return { pass: false, detail: 'Failed to read FC balance: ' + e.message }; }
}

async function checkRouterExempt() {
  try {
    const result = await rpcCall(FC_TOKEN, SEL.exempt + encAddr(UNISWAP_ROUTER));
    const isExempt = decBool(result, 0);
    return {
      pass: isExempt,
      detail: isExempt ? 'Router is exempt from transfer limits' : 'Router NOT exempt — will hit 50K transfer limit',
    };
  } catch (e) { return { pass: false, detail: 'Failed to check router exempt: ' + e.message }; }
}

async function checkPairExists() {
  try {
    const data = SEL.getPair + encAddr(FC_TOKEN) + encAddr(WETH);
    const result = await rpcCall(UNISWAP_FACTORY, data);
    const pairAddr = decAddr(result, 0);
    const exists = pairAddr !== '0x0000000000000000000000000000000000000000';
    return {
      pass: exists,
      detail: exists ? `Pair: ${pairAddr.slice(0, 6)}...${pairAddr.slice(-4)}` : 'No FC/WETH pair on Uniswap — need to create',
      value: exists ? pairAddr : null,
    };
  } catch (e) { return { pass: false, detail: 'Failed to check pair: ' + e.message }; }
}

async function checkPairRegistered() {
  try {
    const result = await rpcCall(FC_TOKEN, SEL.pair);
    const pairAddr = decAddr(result, 0);
    const isSet = pairAddr !== '0x0000000000000000000000000000000000000000';
    return {
      pass: isSet,
      detail: isSet ? `FC token pair set to ${pairAddr.slice(0, 6)}...${pairAddr.slice(-4)}` : 'pair() not set on FC token — need to call setPair()',
      value: isSet ? pairAddr : null,
    };
  } catch (e) { return { pass: false, detail: 'Failed to read pair: ' + e.message }; }
}

async function checkPairExempt(pairAddr) {
  if (!pairAddr) return { pass: false, detail: 'No pair address to check' };
  try {
    const result = await rpcCall(FC_TOKEN, SEL.exempt + encAddr(pairAddr));
    const isExempt = decBool(result, 0);
    return {
      pass: isExempt,
      detail: isExempt ? 'Pair contract is exempt from transfer limits' : 'Pair NOT exempt — swaps will fail on large amounts',
    };
  } catch (e) { return { pass: false, detail: 'Failed to check pair exempt: ' + e.message }; }
}

async function checkRouterApproval(wallet) {
  if (!wallet.account) return { pass: false, detail: 'Wallet not connected' };
  try {
    const data = SEL.allowance + encAddr(wallet.account) + encAddr(UNISWAP_ROUTER);
    const result = await rpcCall(FC_TOKEN, data);
    const allowance = Number(decU256(result, 0)) / 1e18;
    return {
      pass: allowance > 0,
      detail: allowance > 0 ? `Router approved for ${allowance > 1e12 ? 'unlimited' : allowance.toLocaleString()} FC` : 'Router not approved to spend your FC — need to approve',
      value: allowance,
    };
  } catch (e) { return { pass: false, detail: 'Failed to check approval: ' + e.message }; }
}

async function checkLiquidity(pairAddr) {
  if (!pairAddr) return { pass: false, detail: 'No pair to check' };
  try {
    const result = await rpcCall(pairAddr, SEL.getReserves);
    const r0 = Number(decU256(result, 0)) / 1e18;
    const r1 = Number(decU256(result, 1)) / 1e18;
    const hasLiq = r0 > 0 && r1 > 0;
    return {
      pass: hasLiq,
      detail: hasLiq ? `Reserves: ${r0.toFixed(4)} / ${r1.toFixed(4)}` : 'Pair has no liquidity — need to add FC + ETH',
      value: { r0, r1 },
    };
  } catch (e) { return { pass: false, detail: 'Failed to read reserves: ' + e.message }; }
}

// ─── Action Functions (MetaMask) ─────────────────────────

async function sendTx(to, data, value = '0x0', gas = 200000) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('Connect wallet first');
  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: accounts[0], to, data, value, gas: '0x' + gas.toString(16) }],
  });
  // Wait for receipt
  const start = Date.now();
  while (Date.now() - start < 90000) {
    try {
      const receipt = await window.ethereum.request({
        method: 'eth_getTransactionReceipt', params: [txHash],
      });
      if (receipt) {
        if (receipt.status === '0x0') throw new Error('Transaction reverted on-chain');
        return txHash;
      }
    } catch (e) { if (e.message.includes('reverted')) throw e; }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Transaction timed out');
}

export async function actionMintFC(amount) {
  // Try ownerMint (50K/24h limit)
  const amtWei = encU256(BigInt(Math.floor(amount)) * BigInt(1e18));
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  const data = SEL.ownerMint + encAddr(accounts[0]) + amtWei;
  return sendTx(FC_TOKEN, data, '0x0', 150000);
}

export async function actionTreasuryMint(amount) {
  const amtWei = encU256(BigInt(Math.floor(amount)) * BigInt(1e18));
  const data = SEL.treasuryMint + amtWei;
  return sendTx(FC_TOKEN, data, '0x0', 150000);
}

export async function actionSetExempt(address, exempt) {
  const data = SEL.setExempt + encAddr(address) + (exempt ? '0'.repeat(63) + '1' : '0'.repeat(64));
  return sendTx(FC_TOKEN, data, '0x0', 80000);
}

export async function actionSetPair(pairAddress) {
  const data = SEL.setPair + encAddr(pairAddress);
  return sendTx(FC_TOKEN, data, '0x0', 80000);
}

export async function actionApproveRouter(amount) {
  const maxUint = 'f'.repeat(64);
  const data = SEL.approve + encAddr(UNISWAP_ROUTER) + maxUint;
  return sendTx(FC_TOKEN, data, '0x0', 60000);
}

export async function actionCreatePair() {
  const data = SEL.createPair + encAddr(FC_TOKEN) + encAddr(WETH);
  return sendTx(UNISWAP_FACTORY, data, '0x0', 3000000);
}

export async function actionAddLiquidity(fcAmount, ethAmount) {
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  const tokenAmtWei = encU256(BigInt(Math.floor(fcAmount)) * BigInt(1e18));
  const minToken = encU256(BigInt(Math.floor(fcAmount * 0.95)) * BigInt(1e18)); // 5% slippage
  const minETH = encU256(BigInt(Math.floor(ethAmount * 0.95 * 1e18))); // 5% slippage
  const deadline = encU256(Math.floor(Date.now() / 1000) + 1800); // 30 min
  const ethWei = '0x' + BigInt(Math.floor(ethAmount * 1e18)).toString(16);

  const data = SEL.addLiquidityETH
    + encAddr(FC_TOKEN)       // token
    + tokenAmtWei             // amountTokenDesired
    + minToken                // amountTokenMin
    + minETH                  // amountETHMin
    + encAddr(accounts[0])    // to (LP tokens go to sender)
    + deadline;               // deadline

  return sendTx(UNISWAP_ROUTER, data, ethWei, 500000);
}

// ─── Main Pipeline Hook ─────────────────────────────────
export function useTradingPipeline(wallet) {
  const [stages, setStages] = useState(null);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  // Store wallet in a ref so the callback doesn't recreate on every render
  const walletRef = { current: wallet };
  walletRef.current = wallet;

  const runVerification = useCallback(async () => {
    const w = walletRef.current;
    setRunning(true);
    const results = { timestamp: Date.now(), stages: [] };

    // ── Stage 0: Prerequisites (no RPC needed for wallet check) ──
    const s0 = { name: 'Prerequisites', tests: [] };
    const t_wallet = await checkWallet(w);
    s0.tests.push({ id: '0.1', name: 'Wallet Connected + Base Network', ...t_wallet });

    if (!t_wallet.pass) {
      s0.verdict = false;
      results.stages.push(s0);
      results.blocked = 'Stage 0';
      setStages(results);
      setRunning(false);
      return results;
    }

    const t_owner = await checkIsOwner(w);
    await delay(500);
    s0.tests.push({ id: '0.2', name: 'FC Token Owner', ...t_owner });

    const t_eth = await checkETHBalance(w);
    s0.tests.push({ id: '0.3', name: 'ETH for Gas', ...t_eth });

    s0.verdict = s0.tests.every(t => t.pass);
    results.stages.push(s0);

    if (!s0.verdict) {
      results.blocked = 'Stage 0';
      setStages(results);
      setRunning(false);
      return results;
    }

    await delay(800);

    // ── Stage 1: Token State ──
    const s1 = { name: 'Token State', tests: [] };
    const t_supply = await checkTotalSupply();
    s1.tests.push({ id: '1.1', name: 'FC Total Supply > 0', ...t_supply });

    await delay(500);
    const t_balance = await checkOwnerFCBalance(w);
    s1.tests.push({ id: '1.2', name: 'Owner FC Balance > 0', ...t_balance });

    s1.verdict = s1.tests.every(t => t.pass);
    results.stages.push(s1);

    await delay(800);

    // ── Stage 2: Access Control ──
    const s2 = { name: 'Access Control', tests: [] };
    const t_routerExempt = await checkRouterExempt();
    s2.tests.push({ id: '2.1', name: 'Router Exempt from Limits', ...t_routerExempt });

    s2.verdict = s2.tests.every(t => t.pass);
    results.stages.push(s2);

    await delay(800);

    // ── Stage 3: Uniswap Pair ──
    const s3 = { name: 'Uniswap Pair', tests: [] };
    const t_pairExists = await checkPairExists();
    s3.tests.push({ id: '3.1', name: 'FC/WETH Pair Created', ...t_pairExists });

    await delay(500);
    const t_pairReg = await checkPairRegistered();
    s3.tests.push({ id: '3.2', name: 'Pair Set on FC Token', ...t_pairReg });

    const pairAddr = t_pairExists.value || t_pairReg.value;
    if (pairAddr) {
      await delay(500);
      const t_pairExempt = await checkPairExempt(pairAddr);
      s3.tests.push({ id: '3.3', name: 'Pair Exempt from Limits', ...t_pairExempt });
    } else {
      s3.tests.push({ id: '3.3', name: 'Pair Exempt from Limits', pass: false, detail: 'No pair exists yet' });
    }

    s3.verdict = s3.tests.every(t => t.pass);
    results.stages.push(s3);

    await delay(800);

    // ── Stage 4: Liquidity ──
    const s4 = { name: 'Liquidity', tests: [] };
    const t_approval = await checkRouterApproval(w);
    s4.tests.push({ id: '4.1', name: 'FC Approved for Router', ...t_approval });

    await delay(500);
    const t_liq = await checkLiquidity(pairAddr);
    s4.tests.push({ id: '4.2', name: 'Pair Has Reserves', ...t_liq });

    s4.verdict = s4.tests.every(t => t.pass);
    results.stages.push(s4);

    // ── Overall ──
    const totalTests = results.stages.reduce((sum, s) => sum + s.tests.length, 0);
    const passing = results.stages.reduce((sum, s) => sum + s.tests.filter(t => t.pass).length, 0);
    results.total = totalTests;
    results.passing = passing;
    results.ready = results.stages.every(s => s.verdict);

    setStages(results);
    setRunning(false);
    setHasRun(true);
    return results;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — reads wallet from ref

  // Run once when wallet connects, not on every render
  useEffect(() => {
    if (wallet.account && wallet.isBase && !hasRun) {
      runVerification();
    }
  }, [wallet.account, wallet.isBase, hasRun, runVerification]);

  return { stages, running, refresh: runVerification };
}
