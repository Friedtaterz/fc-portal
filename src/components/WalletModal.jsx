import React from 'react';

export default function WalletModal({ wallet }) {
  if (!wallet.showWalletModal) return null;

  return (
    <div className="wallet-modal-overlay" onClick={wallet.closeWalletModal}>
      <div className="wallet-modal" onClick={e => e.stopPropagation()}>
        <button className="wallet-modal-close" onClick={wallet.closeWalletModal}>x</button>

        <h2 className="wallet-modal-title">Connect Your Wallet</h2>
        <p className="wallet-modal-subtitle">
          Choose how you want to connect. If you don't have a wallet yet, Coinbase will help you create one.
        </p>

        <div className="wallet-modal-options">
          {/* Coinbase — works in browser, handles both existing users and new wallet creation */}
          <button className="wallet-modal-option" onClick={wallet.connectCoinbase} disabled={wallet.connecting}>
            <div className="wallet-modal-icon" style={{ background: '#0052FF' }}>C</div>
            <div className="wallet-modal-info">
              <span className="wallet-modal-name">
                Coinbase Wallet
                <span className="wallet-modal-tag">Recommended</span>
              </span>
              <span className="wallet-modal-desc">
                Connect existing wallet or create a new one — no app needed
              </span>
            </div>
            <span className="wallet-modal-arrow">&rsaquo;</span>
          </button>

          {/* MetaMask — only on mobile, opens page in MetaMask's browser */}
          {wallet.isMobile && (
            <button className="wallet-modal-option" onClick={wallet.openInMetaMask}>
              <div className="wallet-modal-icon" style={{ background: '#E2761B' }}>M</div>
              <div className="wallet-modal-info">
                <span className="wallet-modal-name">MetaMask</span>
                <span className="wallet-modal-desc">
                  Opens this page inside the MetaMask app
                </span>
              </div>
              <span className="wallet-modal-arrow">&rsaquo;</span>
            </button>
          )}

          {/* Desktop without extension — link to install */}
          {!wallet.isMobile && (
            <a
              className="wallet-modal-option"
              href="https://metamask.io/download/"
              target="_blank"
              rel="noreferrer"
            >
              <div className="wallet-modal-icon" style={{ background: '#E2761B' }}>M</div>
              <div className="wallet-modal-info">
                <span className="wallet-modal-name">MetaMask</span>
                <span className="wallet-modal-desc">
                  Install the browser extension, then refresh
                </span>
              </div>
              <span className="wallet-modal-arrow">&rsaquo;</span>
            </a>
          )}
        </div>

        {wallet.error && (
          <div className="wallet-modal-error">{wallet.error}</div>
        )}

        {wallet.connecting && (
          <div className="wallet-modal-loading">Connecting...</div>
        )}

        <button className="wallet-modal-skip" onClick={wallet.closeWalletModal}>
          Cancel
        </button>
      </div>
    </div>
  );
}
