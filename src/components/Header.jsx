import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV = [
  { path: '/',           label: 'Dashboard' },
  { path: '/pool',       label: 'Family Pools' },
  { path: '/trade',      label: 'Buy / Sell' },
  { path: '/how',        label: 'How It Works' },
];

export default function Header({ wallet }) {
  const loc = useLocation();

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="logo">
          <span className="logo-icon">FC</span>
          <span className="logo-text">FractalCoin</span>
        </Link>

        <nav className="nav">
          {NAV.map(n => (
            <Link
              key={n.path}
              to={n.path}
              className={'nav-link' + (loc.pathname === n.path ? ' active' : '')}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="wallet-area">
          {!wallet.account ? (
            <button onClick={wallet.connect} className="btn btn-primary" disabled={wallet.connecting}>
              {wallet.connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : !wallet.isBase ? (
            <button onClick={wallet.switchToBase} className="btn btn-warning">
              Switch to Base
            </button>
          ) : (
            <div className="wallet-connected">
              <span className="wallet-dot" />
              <span className="wallet-addr">{wallet.shortAddress}</span>
              <button onClick={wallet.disconnect} className="btn-disconnect" title="Disconnect">x</button>
            </div>
          )}
          {wallet.error && (
            <div style={{ position: 'absolute', top: '100%', right: 0, background: '#2a1a0a', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#f59e0b', whiteSpace: 'nowrap', marginTop: 4, zIndex: 100 }}>
              {wallet.error}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
