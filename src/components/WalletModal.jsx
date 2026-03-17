import React from 'react';

const DAPP_URL = typeof window !== 'undefined'
  ? window.location.href.replace(/^https?:\/\//, '')
  : '';

const WALLETS = [
  {
    name: 'Coinbase Wallet',
    desc: 'Create a wallet with just your email — easiest for beginners',
    color: '#0052FF',
    mobileLink: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(window?.location?.href || '')}`,
    desktopLink: 'https://www.coinbase.com/wallet',
    tag: 'Recommended',
  },
  {
    name: 'MetaMask',
    desc: 'Most popular crypto wallet',
    color: '#E2761B',
    mobileLink: `https://metamask.app.link/dapp/${DAPP_URL}`,
    desktopLink: 'https://metamask.io/download/',
    tag: null,
  },
  {
    name: 'Trust Wallet',
    desc: 'Simple and secure mobile wallet',
    color: '#3375BB',
    mobileLink: `https://link.trustwallet.com/open_url?coin_id=8453&url=${encodeURIComponent(window?.location?.href || '')}`,
    desktopLink: 'https://trustwallet.com/download',
    tag: null,
  },
];

export default function WalletModal({ open, onClose, isMobile }) {
  if (!open) return null;

  const handlePick = (wallet) => {
    const link = isMobile ? wallet.mobileLink : wallet.desktopLink;
    if (isMobile) {
      // On mobile, open wallet's in-app browser with our dapp loaded
      window.location.href = link;
    } else {
      window.open(link, '_blank');
    }
  };

  return (
    <div className="wallet-modal-overlay" onClick={onClose}>
      <div className="wallet-modal" onClick={e => e.stopPropagation()}>
        <button className="wallet-modal-close" onClick={onClose}>x</button>

        <h2 className="wallet-modal-title">
          {isMobile ? 'Open with a Wallet App' : 'Get a Wallet'}
        </h2>
        <p className="wallet-modal-subtitle">
          {isMobile
            ? "Pick a wallet app below. If you already have one installed, it'll open automatically. If not, you'll be taken to install it."
            : "Install a browser wallet extension to connect. If you're new to crypto, Coinbase Wallet is the easiest way to start."
          }
        </p>

        <div className="wallet-modal-options">
          {WALLETS.map(w => (
            <button
              key={w.name}
              className="wallet-modal-option"
              onClick={() => handlePick(w)}
            >
              <div className="wallet-modal-icon" style={{ background: w.color }}>
                {w.name[0]}
              </div>
              <div className="wallet-modal-info">
                <span className="wallet-modal-name">
                  {w.name}
                  {w.tag && <span className="wallet-modal-tag">{w.tag}</span>}
                </span>
                <span className="wallet-modal-desc">{w.desc}</span>
              </div>
              <span className="wallet-modal-arrow">&rsaquo;</span>
            </button>
          ))}
        </div>

        {isMobile && (
          <p className="wallet-modal-hint">
            Already have a wallet? Open its app, find the built-in browser, and paste this site's URL.
          </p>
        )}

        <button className="wallet-modal-skip" onClick={onClose}>
          Continue without wallet
        </button>
      </div>
    </div>
  );
}
