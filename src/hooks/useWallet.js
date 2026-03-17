import { useState, useEffect, useCallback, useRef } from 'react';
import { CoinbaseWalletSDK } from '@coinbase/wallet-sdk';
import { BASE_CHAIN_ID, BASE_CHAIN_HEX, BASE_RPC } from '../config';

// Detect any already-injected EVM wallet provider (extensions, in-app browsers)
function getInjectedProvider() {
  if (typeof window === 'undefined') return null;
  if (window.ethereum?.providers?.length) return window.ethereum.providers[0];
  return window.ethereum || window.coinbaseWalletExtension || window.trustwallet || null;
}

// Create Coinbase Wallet SDK provider — works in ANY browser, no app needed.
// User signs in with email/passkey, gets a smart wallet on Base.
let _cbProvider = null;
function getCoinbaseProvider() {
  if (_cbProvider) return _cbProvider;
  const sdk = new CoinbaseWalletSDK({
    appName: 'FractalCoin',
    appChainIds: [BASE_CHAIN_ID],
  });
  _cbProvider = sdk.makeWeb3Provider({
    options: 'smartWalletOnly',
  });
  return _cbProvider;
}

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const isBase = chainId === BASE_CHAIN_ID;
  const providerRef = useRef(null);
  const [hasWallet, setHasWallet] = useState(!!getInjectedProvider());

  // Detect late-injected wallets
  useEffect(() => {
    if (hasWallet) return;
    if (getInjectedProvider()) { setHasWallet(true); return; }
    const onInjected = () => { if (getInjectedProvider()) setHasWallet(true); };
    window.addEventListener('ethereum#initialized', onInjected);
    window.addEventListener('eip6963:announceProvider', onInjected);
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}
    const check = setInterval(() => { if (getInjectedProvider()) { setHasWallet(true); clearInterval(check); } }, 200);
    const stop = setTimeout(() => clearInterval(check), 5000);
    return () => { window.removeEventListener('ethereum#initialized', onInjected); window.removeEventListener('eip6963:announceProvider', onInjected); clearInterval(check); clearTimeout(stop); };
  }, [hasWallet]);

  // Listen for account/chain changes on whatever provider we're using
  useEffect(() => {
    const eth = providerRef.current || getInjectedProvider();
    if (!eth) return;

    const onAccounts = (accs) => setAccount(accs[0] || null);
    const onChain = (id) => setChainId(parseInt(id, 16));

    eth.on('accountsChanged', onAccounts);
    eth.on('chainChanged', onChain);

    eth.request({ method: 'eth_accounts' }).then(onAccounts).catch(() => {});
    eth.request({ method: 'eth_chainId' }).then(onChain).catch(() => {});

    return () => {
      eth.removeListener('accountsChanged', onAccounts);
      eth.removeListener('chainChanged', onChain);
    };
  }, [hasWallet, account]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    try {
      // Use injected provider if available (MetaMask extension, in-app wallet browser, etc.)
      // Otherwise fall back to Coinbase Wallet SDK — works in any browser, no app download needed
      let eth = getInjectedProvider();
      if (!eth) {
        eth = getCoinbaseProvider();
      }
      providerRef.current = eth;

      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0] || null);
      if (!hasWallet) setHasWallet(true);

      const chain = await eth.request({ method: 'eth_chainId' });
      const chainNum = parseInt(chain, 16);
      setChainId(chainNum);

      if (chainNum !== BASE_CHAIN_ID) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_HEX }] });
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await eth.request({
              method: 'wallet_addEthereumChain',
              params: [{ chainId: BASE_CHAIN_HEX, chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [BASE_RPC], blockExplorerUrls: ['https://basescan.org'] }],
            });
          }
        }
      }

      setConnecting(false);

      // Auto-add FC token (fire-and-forget, only once)
      try {
        if (!localStorage.getItem('fc_token_added')) {
          eth.request({
            method: 'wallet_watchAsset',
            params: { type: 'ERC20', options: { address: '0x4ef6025daa23496831e9b2ef419f6541d2dbd013', symbol: 'FC', decimals: 18 } },
          }).then(() => { try { localStorage.setItem('fc_token_added', '1'); } catch {} }).catch(() => {});
        }
      } catch {}
      return;
    } catch (err) {
      if (err.code === 4001) setError('Connection rejected');
      else setError(err.message);
    }
    setConnecting(false);
  }, [hasWallet]);

  const switchToBase = useCallback(async () => {
    const eth = providerRef.current || getInjectedProvider();
    if (!eth) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_HEX }] });
    } catch (err) {
      if (err.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: BASE_CHAIN_HEX, chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [BASE_RPC], blockExplorerUrls: ['https://basescan.org'] }],
        });
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    providerRef.current = null;
  }, []);

  const shortAddress = account ? account.slice(0, 6) + '...' + account.slice(-4) : null;

  return { account, shortAddress, chainId, isBase, connecting, error, hasMetaMask: hasWallet, connect, switchToBase, disconnect };
}
