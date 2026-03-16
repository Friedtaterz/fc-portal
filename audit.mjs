// FC Ecosystem On-Chain Audit
// Uses a single RPC with 300ms delay between calls to avoid rate limits

const RPC = 'https://base.llamarpc.com';

const ADDRS = {
  fc:      '0x4ef6025daa23496831e9b2ef419f6541d2dbd013',
  pools:   '0x3420FDa720a98297Bc2f3F503433F76EbE6517d6',
  fnc:     '0x8bb92439c1074F42DB3F71ad8A48CAe07b8D2ecE',
  pair:    '0xfc334caddffd1d7f5a176a7459e520bb5efda389',
  weth:    '0x4200000000000000000000000000000000000006',
  owner:   '0xAd62EC834E3711B33c56915A6f5e99164a83134b',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let callId = 0;

async function rpc(to, data, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    await sleep(300);
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++callId, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      const j = await res.json();
      if (j.error) {
        if (i < retries && j.error.message?.includes('rate')) continue;
        return null;
      }
      return j.result;
    } catch (e) {
      if (i === retries) return null;
    }
  }
}

async function getBalance(addr) {
  await sleep(300);
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++callId, method: 'eth_getBalance', params: [addr, 'latest'] }),
    });
    const j = await res.json();
    return j.error ? 0n : BigInt(j.result);
  } catch { return 0n; }
}

function balOf(token, who) {
  return rpc(token, '0x70a08231' + who.replace('0x','').padStart(64,'0'));
}
function toE(wei) { return (Number(wei) / 1e18).toFixed(6); }
function toFC(wei) { return (Number(wei) / 1e18).toFixed(2); }

async function main() {
  console.log('=== FC ECOSYSTEM ON-CHAIN AUDIT ===');
  console.log('Date:', new Date().toISOString());
  console.log('RPC:', RPC);
  console.log('');

  // 1. Uniswap Pair
  console.log('--- UNISWAP PAIR ---');
  const reserves = await rpc(ADDRS.pair, '0x0902f1ac');
  if (!reserves) { console.log('ERROR: Could not fetch reserves'); return; }

  const r0 = BigInt('0x' + reserves.slice(2, 66));
  const r1 = BigInt('0x' + reserves.slice(66, 130));
  const token0 = await rpc(ADDRS.pair, '0x0dfe1681');
  const t0addr = token0 ? '0x' + token0.slice(26).toLowerCase() : '';

  let reserveFC, reserveETH;
  if (t0addr === ADDRS.fc.toLowerCase()) {
    reserveFC = r0; reserveETH = r1;
  } else {
    reserveFC = r1; reserveETH = r0;
  }

  const ethUsd = 2000;
  const fcPriceETH = Number(reserveETH) / Number(reserveFC);
  const fcPriceUSD = fcPriceETH * ethUsd;
  const poolUSD = (Number(reserveETH) / 1e18) * ethUsd * 2;

  console.log('Reserve FC:    ' + toFC(reserveFC) + ' FC');
  console.log('Reserve ETH:   ' + toE(reserveETH) + ' ETH');
  console.log('FC Price:      ' + fcPriceETH.toExponential(4) + ' ETH ($' + fcPriceUSD.toFixed(8) + ')');
  console.log('Pool Value:    $' + poolUSD.toFixed(2) + ' (using $' + ethUsd + '/ETH)');
  console.log('');

  // 2. FC Token
  console.log('--- FC TOKEN ---');
  const fcSupplyRaw = await rpc(ADDRS.fc, '0x18160ddd');
  const fcSupply = fcSupplyRaw ? BigInt(fcSupplyRaw) : 0n;

  const fcOwnerRaw = await balOf(ADDRS.fc, ADDRS.owner);
  const fcOwner = fcOwnerRaw ? BigInt(fcOwnerRaw) : 0n;

  const fcPoolsRaw = await balOf(ADDRS.fc, ADDRS.pools);
  const fcPools = fcPoolsRaw ? BigInt(fcPoolsRaw) : 0n;

  const fcPairRaw = await balOf(ADDRS.fc, ADDRS.pair);
  const fcPair = fcPairRaw ? BigInt(fcPairRaw) : 0n;

  const fcAccounted = fcOwner + fcPools + fcPair;
  const fcUnaccounted = fcSupply - fcAccounted;

  console.log('Total Supply:  ' + toFC(fcSupply) + ' FC');
  console.log('Owner wallet:  ' + toFC(fcOwner) + ' FC');
  console.log('Pools contract:' + toFC(fcPools) + ' FC');
  console.log('Uniswap pair:  ' + toFC(fcPair) + ' FC');
  console.log('Accounted:     ' + toFC(fcAccounted) + ' FC');
  console.log('Unaccounted:   ' + toFC(fcUnaccounted) + ' FC' + (fcUnaccounted > 0n ? ' (other holders)' : ' OK'));
  console.log('');

  // 3. FNC Token
  console.log('--- FNC TOKEN ---');
  const fncSupplyRaw = await rpc(ADDRS.fnc, '0x18160ddd');
  const fncSupply = fncSupplyRaw ? BigInt(fncSupplyRaw) : 0n;

  const fncOwnerRaw = await balOf(ADDRS.fnc, ADDRS.owner);
  const fncOwner = fncOwnerRaw ? BigInt(fncOwnerRaw) : 0n;

  const fncPoolsRaw = await balOf(ADDRS.fnc, ADDRS.pools);
  const fncPools = fncPoolsRaw ? BigInt(fncPoolsRaw) : 0n;

  console.log('Total Supply:  ' + toFC(fncSupply) + ' FNC');
  console.log('Owner wallet:  ' + toFC(fncOwner) + ' FNC');
  console.log('Pools contract:' + toFC(fncPools) + ' FNC');
  console.log('');

  // 4. Owner Wallet
  console.log('--- OWNER WALLET ---');
  const ownerETH = await getBalance(ADDRS.owner);
  console.log('ETH:           ' + toE(ownerETH) + ' ETH ($' + ((Number(ownerETH) / 1e18) * ethUsd).toFixed(2) + ')');
  console.log('FC:            ' + toFC(fcOwner) + ' FC');
  console.log('FNC:           ' + toFC(fncOwner) + ' FNC');
  console.log('');

  // 5. Pools Contract
  console.log('--- FC POOLS CONTRACT ---');
  const poolsETH = await getBalance(ADDRS.pools);
  console.log('ETH held:      ' + toE(poolsETH) + ' ETH');
  console.log('FC held:       ' + toFC(fcPools) + ' FC');
  console.log('FNC held:      ' + toFC(fncPools) + ' FNC');

  // familySplitBps
  const splitRaw = await rpc(ADDRS.pools, '0xe84faf2d');
  const splitBps = splitRaw ? Number(BigInt(splitRaw)) : -1;
  console.log('familySplitBps:' + splitBps + ' (' + (splitBps/100) + '% to family pool)');
  if (splitBps === 5000) {
    console.log('  >> NEEDS FIX: Still 50/50, should be 9500 (95/5)');
  } else if (splitBps === 9500) {
    console.log('  >> OK: Correctly set to 95/5');
  }

  // poolCount
  const pcRaw = await rpc(ADDRS.pools, '0x05b83889');
  const poolCount = pcRaw ? Number(BigInt(pcRaw)) : 0;
  console.log('Pool count:    ' + poolCount);

  // founder status
  const founderRaw = await rpc(ADDRS.pools, '0x4d853ee5' + ADDRS.owner.replace('0x','').padStart(64,'0'));
  if (founderRaw) {
    console.log('Owner founder: ' + (BigInt(founderRaw) !== 0n ? 'YES' : 'NO'));
  }

  // mainPoolFNC
  const mainPoolRaw = await rpc(ADDRS.pools, '0x7e6b3b25');
  if (mainPoolRaw) {
    const mainPoolFNC = BigInt(mainPoolRaw);
    console.log('mainPoolFNC:   ' + toFC(mainPoolFNC) + ' FNC');
    if (mainPoolFNC > 0n) console.log('  >> FNC stuck in treasury from 50/50 era');
  }
  console.log('');

  // 6. Fee Flow Analysis
  console.log('--- FEE FLOW ANALYSIS (per 1 ETH deposit) ---');
  const founderFeeBps = 500;
  const dep = 1.0;
  const fee = dep * founderFeeBps / 10000;
  const family = fee * splitBps / 10000;
  const treasury = fee - family;
  console.log('Deposit:       1.0 ETH');
  console.log('Founder fee:   ' + fee + ' ETH (5%)');
  console.log('-> Family:     ' + family.toFixed(4) + ' ETH (' + (splitBps/100) + '%)');
  console.log('-> Treasury:   ' + treasury.toFixed(4) + ' ETH (' + ((10000-splitBps)/100) + '%)');
  console.log('User gets:     ' + (dep - fee) + ' ETH (95%)');

  if (splitBps === 5000) {
    console.log('');
    console.log('AFTER FIX (9500):');
    const fixFamily = fee * 9500 / 10000;
    const fixTreasury = fee - fixFamily;
    console.log('-> Family:     ' + fixFamily.toFixed(4) + ' ETH (95%)');
    console.log('-> Treasury:   ' + fixTreasury.toFixed(4) + ' ETH (5%)');
  }
  console.log('');

  // 7. Director AI Readiness
  console.log('--- DIRECTOR AI READINESS ---');
  const ownerETHNum = Number(ownerETH) / 1e18;
  const gasReserve = 0.002;
  console.log('Owner ETH:     ' + ownerETHNum.toFixed(6));
  console.log('Gas reserve:   ' + gasReserve);
  console.log('Available:     ' + Math.max(0, ownerETHNum - gasReserve).toFixed(6));
  if (ownerETHNum < gasReserve) {
    console.log('>> BLOCKED: Need ~' + (gasReserve - ownerETHNum + 0.003).toFixed(4) + ' ETH to start Director');
  } else {
    console.log('>> READY to trade');
  }
  if (poolUSD < 1000) {
    console.log('>> Growth Mode (pool < $1K): Director adds liquidity directly');
  }
  console.log('');

  // Summary
  console.log('=== ACTION ITEMS ===');
  const items = [];
  if (splitBps === 5000) items.push('FIX familySplitBps: Click orange banner on Pool page -> set to 9500');
  if (ownerETHNum < gasReserve) items.push('FUND WALLET: Send ~0.005 ETH to ' + ADDRS.owner);
  if (items.length === 0) console.log('No critical issues!');
  else items.forEach((a,i) => console.log((i+1) + '. ' + a));
  console.log('');
  console.log('=== AUDIT COMPLETE ===');
}

main().catch(e => console.error('FATAL:', e.message));
