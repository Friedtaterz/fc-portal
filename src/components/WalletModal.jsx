import React from 'react';

export default function WalletModal({ wallet }) {
  if (!wallet.showWalletModal) return null;

  return (
    <div className="wallet-modal-overlay" onClick={wallet.closeWalletModal}>
      <div className="wallet-modal" onClick={e => e.stopPropagation()}>
        <button className="wallet-modal-close" onClick={wallet.closeWalletModal}>x</button>

        <h2 className="wallet-modal-title">Connect Your Wallet</h2>
        <p className="wallet-modal-subtitle">
          Choose how you want to connect.{' '}
          {!wallet.hasMetaMaskExt && !wallet.isMobile && 'No wallet? Install MetaMask to get started.'}
        </p>

        <div className="wallet-modal-options">
          {/* MetaMask — PRIMARY option. Connect button on desktop if detected, deep link on mobile */}
          {wallet.isMobile ? (
            <button className="wallet-modal-option" onClick={wallet.openInMetaMask}>
              <div className="wallet-modal-icon" style={{ background: '#E2761B' }}>M</div>
              <div className="wallet-modal-info">
                <span className="wallet-modal-name">
                  MetaMask
                  <span className="wallet-modal-tag">Recommended</span>
                </span>
                <span className="wallet-modal-desc">
                  Opens this page inside the MetaMask app
                </span>
              </div>
              <span className="wallet-modal-arrow">&rsaquo;</span>
            </button>
          ) : wallet.hasMetaMaskExt ? (
            <button className="wallet-modal-option" onClick={wallet.connectMetaMask} disabled={wallet.connecting}>
              <div className="wallet-modal-icon" style={{ background: '#E2761B' }}>M</div>
              <div className="wallet-modal-info">
                <span className="wallet-modal-name">
                  MetaMask
                  <span className="wallet-modal-tag">Recommended</span>
                </span>
                <span className="wallet-modal-desc">
                  Connect your MetaMask wallet
                </span>
              </div>
              <span className="wallet-modal-arrow">&rsaquo;</span>
            </button>
          ) : (
            <a
              className="wallet-modal-option"
              href="https://metamask.io/download/"
              target="_blank"
              rel="noreferrer"
            >
              <div className="wallet-modal-icon" style={{ background: '#E2761B' }}>M</div>
              <div className="wallet-modal-info">
                <span className="wallet-modal-name">
                  MetaMask
                  <span className="wallet-modal-tag">Recommended</span>
                </span>
                <span className="wallet-modal-desc">
                  Install the browser extension, then refresh
                </span>
              </div>
              <span className="wallet-modal-arrow">&rsaquo;</span>
            </a>
          )}

          {/* Coinbase — secondary option for users who already have Coinbase Wallet */}
          <button className="wallet-modal-option" onClick={wallet.connectCoinbase} disabled={wallet.connecting}>
            <div className="wallet-modal-icon" style={{ background: '#0052FF' }}>C</div>
            <div className="wallet-modal-info">
              <span className="wallet-modal-name">Coinbase Wallet</span>
              <span className="wallet-modal-desc">
                Connect existing Coinbase Wallet
              </span>
            </div>
            <span className="wallet-modal-arrow">&rsaquo;</span>
          </button>
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
