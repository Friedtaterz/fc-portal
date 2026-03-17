import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import WalletModal from './components/WalletModal';
import Dashboard from './pages/Dashboard';
import Pool from './pages/Pool';
import Trade from './pages/Trade';
import HowItWorks from './pages/HowItWorks';
import { useWallet } from './hooks/useWallet';
import { useChainData } from './hooks/useChainData';

export default function App() {
  const wallet = useWallet();
  const chain = useChainData(wallet.account);

  return (
    <HashRouter>
      <div className="app">
        <Header wallet={wallet} />
        <WalletModal open={wallet.showWalletModal} onClose={wallet.closeWalletModal} isMobile={wallet.isMobile} />
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard chain={chain} wallet={wallet} />} />
            <Route path="/pool" element={<Pool chain={chain} wallet={wallet} />} />
            <Route path="/trade" element={<Trade chain={chain} wallet={wallet} />} />
            <Route path="/how" element={<HowItWorks />} />
          </Routes>
        </main>
        <footer className="footer">
          <span>FractalCoin on Base</span>
          <span className="footer-dot" />
          <a href="https://basescan.org/token/0x4ef6025daa23496831e9b2ef419f6541d2dbd013" target="_blank" rel="noreferrer">BaseScan</a>
          <span className="footer-dot" />
          <a href="https://app.uniswap.org/swap?outputCurrency=0x4ef6025daa23496831e9b2ef419f6541d2dbd013&chain=base" target="_blank" rel="noreferrer">Uniswap</a>
        </footer>
      </div>
    </HashRouter>
  );
}
