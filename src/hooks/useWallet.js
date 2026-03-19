import { useState, useEffect, useCallback, useRef } from 'react';
import { CoinbaseWalletSDK } from '@coinbase/wallet-sdk';
import { BASE_CHAIN_ID, BASE_CHAIN_HEX, BASE_RPC } from '../config';

// Detect any already-injected EVM wallet provider (extensions, in-app browsers)
function getInjectedProvider() {
  if (typeof window === 'undefined') return null;
  if (window.ethereum?.providers?.length) return window.ethereum.providers[0];
  return window.ethereum || window.coinbaseWalletExtension || window.trustwallet || null;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Coinbase Wallet SDK — 'smartWalletOnly' avoids the create-wallet KYC flow
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
  const [showWalletModal, setShowWalletModal] = useState(false);

  const isBase = chainId === BASE_CHAIN_ID;
  const providerRef = useRef(null);
  const [hasWallet, setHasWallet] = useState(!!getInjectedProvider());
  const [hasMetaMaskExt, setHasMetaMaskExt] = useState(false);

  // Detect late-injected wallets (MetaMask can be slow)
  useEffect(() => {
    const detect = () => {
      const eth = getInjectedProvider();
      if (eth) {
        setHasWallet(true);
        // Check if it's actually MetaMask (vs Coinbase or other)
        if (eth.isMetaMask || eth.providers?.some(p => p.isMetaMask)) {
          setHasMetaMaskExt(true);
        }
      }
    };
    detect();
    if (hasWallet) return;
    const onInjected = () => detect();
    window.addEventListener('ethereum#initialized', onInjected);
    window.addEventListener('eip6963:announceProvider', onInjected);
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}
    const check = setInterval(() => { detect(); if (hasWallet) clearInterval(check); }, 200);
    const stop = setTimeout(() => clearInterval(check), 5000);
    return () => { window.removeEventListener('ethereum#initialized', onInjected); window.removeEventListener('eip6963:announceProvider', onInjected); clearInterval(check); clearTimeout(stop); };
  }, [hasWallet]);

  // Listen for account/chain changes
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

  // Shared logic: once we have a provider, request accounts and switch to Base
  const finishConnect = useCallback(async (eth) => {
    providerRef.current = eth;
    setConnecting(true);
    setError(null);

    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0] || null);
      if (!hasWallet) setHasWallet(true);
      setShowWalletModal(false);

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

      // Auto-add FC token (fire-and-forget, only once)
      try {
        if (!localStorage.getItem('fc_token_added')) {
          eth.request({
            method: 'wallet_watchAsset',
            params: { type: 'ERC20', options: { address: '0x4ef6025daa23496831e9b2ef419f6541d2dbd013', symbol: 'FC', decimals: 18 } },
          }).then(() => { try { localStorage.setItem('fc_token_added', '1'); } catch {} }).catch(() => {});
        }
      } catch {}
    } catch (err) {
      if (err.code === 4001) setError('Connection rejected');
      else setError(err.message);
    }
    setConnecting(false);
  }, [hasWallet]);

  // Main connect — tries injected provider first, shows modal if none found
  const connect = useCallback(async () => {
    let eth = getInjectedProvider();

    // Wait a beat for late-injecting wallets (MetaMask can be slow on both mobile and desktop)
    if (!eth) {
      await new Promise(r => setTimeout(r, 600));
      eth = getInjectedProvider();
    }

    if (eth) {
      // Has a wallet extension or we're inside a wallet's in-app browser — connect directly
      await finishConnect(eth);
    } else {
      // No wallet detected — show the picker modal
      setShowWalletModal(true);
    }
  }, [finishConnect]);

  // Connect via injected MetaMask (called from modal — works even when detection was slow)
  const connectMetaMask = useCallback(async () => {
    // Try to find MetaMask specifically in multi-provider setups
    let eth = null;
    if (window.ethereum?.providers?.length) {
      eth = window.ethereum.providers.find(p => p.isMetaMask) || null;
    }
    if (!eth && window.ethereum?.isMetaMask) eth = window.ethereum;
    if (!eth) eth = getInjectedProvider(); // last resort — use whatever is there
    if (eth) {
      await finishConnect(eth);
    } else {
      setError('MetaMask not found. Install it and refresh the page.');
    }
  }, [finishConnect]);

  // Connect via Coinbase Wallet SDK (called from modal)
  const connectCoinbase = useCallback(async () => {
    const eth = getCoinbaseProvider();
    await finishConnect(eth);
  }, [finishConnect]);

  // Open page in MetaMask's in-app browser (called from modal on mobile)
  const openInMetaMask = useCallback(() => {
    const dappUrl = window.location.href.replace(/^https?:\/\//, '');
    window.location.href = `https://metamask.app.link/dapp/${dappUrl}`;
  }, []);

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
    _cbProvider = null;
  }, []);

  const closeWalletModal = useCallback(() => setShowWalletModal(false), []);

  const shortAddress = account ? account.slice(0, 6) + '...' + account.slice(-4) : null;

  return {
    account, shortAddress, chainId, isBase, connecting, error,
    hasMetaMask: hasWallet, hasMetaMaskExt, connect, connectMetaMask, switchToBase, disconnect,
    showWalletModal, closeWalletModal, connectCoinbase, openInMetaMask,
    isMobile: isMobile(),
  };
}
