// ─── FractalCoin Contract Addresses (Base Mainnet) ───────────────
export const FC_TOKEN    = '0x4ef6025daa23496831e9b2ef419f6541d2dbd013';
export const FC_POOLS    = '0x3420FDa720a98297Bc2f3F503433F76EbE6517d6'; // V3 — invite-only + deposit more
export const FNC_TOKEN   = '0x8bb92439c1074F42DB3F71ad8A48CAe07b8D2ecE';
export const WETH        = '0x4200000000000000000000000000000000000006';
export const UNISWAP_ROUTER = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
export const UNISWAP_FACTORY = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6';

// Base Mainnet RPC (round-robin to avoid rate limits)
const RPC_LIST = [
  'https://base.llamarpc.com',
  'https://1rpc.io/base',
  'https://base.drpc.org',
  'https://mainnet.base.org',
];
let _rpcIdx = 0;
export function getBaseRPC() {
  const url = RPC_LIST[_rpcIdx % RPC_LIST.length];
  _rpcIdx++;
  return url;
}
export const BASE_RPC = RPC_LIST[0];
export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_HEX = '0x2105';

// BaseScan links
export const BASESCAN_TOKEN = `https://basescan.org/token/${FC_TOKEN}`;
export const BASESCAN_POOLS = `https://basescan.org/address/${FC_POOLS}`;

// Uniswap trade link
export const UNISWAP_BUY_URL = `https://app.uniswap.org/swap?outputCurrency=${FC_TOKEN}&chain=base`;
export const UNISWAP_SELL_URL = `https://app.uniswap.org/swap?inputCurrency=${FC_TOKEN}&chain=base`;

// Tier thresholds (matches FCDirectorAI)
export const TIERS = [
  { name: 'Pool Building',  max: 1_000,       profit: 0,   reinvest: 100, color: '#3b82f6', icon: '🌱' },
  { name: 'Direct Payout',  max: 100_000,     profit: 30,  reinvest: 70,  color: '#10b981', icon: '📈' },
  { name: 'Scaling',        max: 10_000_000,  profit: 50,  reinvest: 50,  color: '#f59e0b', icon: '🚀' },
  { name: 'Trust Mode',     max: Infinity,    profit: 80,  reinvest: 20,  color: '#8b5cf6', icon: '👑' },
];

// ERC-20 function selectors
export const SEL = {
  totalSupply: '0x18160ddd',
  balanceOf:   '0x70a08231',
  name:        '0x06fdde03',
  symbol:      '0x95d89b41',
  decimals:    '0x313ce567',
  getReserves: '0x0902f1ac',
};
