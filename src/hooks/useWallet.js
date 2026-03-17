import { useState, useEffect, useCallback } from 'react';
import { BASE_CHAIN_ID, BASE_CHAIN_HEX, BASE_RPC } from '../config';

// Detect any EVM wallet provider
function getProvider() {
  if (typeof window === 'undefined') return null;
  if (window.ethereum?.providers?.length) return window.ethereum.providers[0];
  return window.ethereum || window.coinbaseWalletExtension || window.trustwallet || null;
}

// Detect mobile
function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const isBase = chainId === BASE_CHAIN_ID;
  const [hasWallet, setHasWallet] = useState(!!getProvider());

  // Detect late-injected wallets
  useEffect(() => {
    if (hasWallet) return;
    if (getProvider()) { setHasWallet(true); return; }
    const onInjected = () => { if (getProvider()) setHasWallet(true); };
    window.addEventListener('ethereum#initialized', onInjected);
    window.addEventListener('eip6963:announceProvider', onInjected);
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}
    const check = setInterval(() => { if (getProvider()) { setHasWallet(true); clearInterval(check); } }, 200);
    const stop = setTimeout(() => clearInterval(check), 5000);
    return () => { window.removeEventListener('ethereum#initialized', onInjected); window.removeEventListener('eip6963:announceProvider', onInjected); clearInterval(check); clearTimeout(stop); };
  }, [hasWallet]);

  // Listen for account/chain changes
  useEffect(() => {
    const eth = getProvider();
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
  }, [hasWallet]);

  const connect = useCallback(async () => {
    let eth = getProvider();

    // On mobile, wait a beat for late-injecting wallets (Coinbase Wallet, Trust, etc.)
    if (!eth && isMobile()) {
      await new Promise(r => setTimeout(r, 500));
      eth = getProvider();
    }

    if (!eth) {
      // No wallet found — show options, don't just redirect to Play Store
      if (isMobile()) {
        // Give user a choice instead of auto-redirecting
        const choice = confirm(
          'No crypto wallet detected.\n\n' +
          'OK = Open this page inside MetaMask app\n' +
          'Cancel = Continue without wallet\n\n' +
          'If you already have MetaMask installed, open it and use its built-in browser to visit this site.'
        );
        if (choice) {
          const dappUrl = window.location.href.replace(/^https?:\/\//, '');
          window.location.href = `https://metamask.app.link/dapp/${dappUrl}`;
        } else {
          setError('No wallet detected. Install MetaMask, Coinbase Wallet, or Trust Wallet, then open this site from inside the wallet app.');
        }
        return;
      }
      // Desktop without extension
      setError('No wallet extension found. Install MetaMask (metamask.io) or Coinbase Wallet, then refresh.');
      window.open('https://metamask.io/download/', '_blank');
      return;
    }

    if (!hasWallet) setHasWallet(true);
    setConnecting(true);
    setError(null);
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0] || null);

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
    const eth = getProvider();
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
  }, [hasWallet]);

  const disconnect = useCallback(() => { setAccount(null); }, []);

  const shortAddress = account ? account.slice(0, 6) + '...' + account.slice(-4) : null;

  return { account, shortAddress, chainId, isBase, connecting, error, hasMetaMask: hasWallet, connect, switchToBase, disconnect };
}
