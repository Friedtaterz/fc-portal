import React from 'react';
import { TIERS, BASESCAN_TOKEN, BASESCAN_POOLS, FC_TOKEN, FC_POOLS } from '../config';

export default function HowItWorks() {
  return (
    <div className="page how-page">
      <h1>How FractalCoin Works</h1>
      <p className="hero-sub">A plain-English guide. No jargon, no confusion.</p>

      {/* Big Idea */}
      <div className="section highlight-box">
        <h2>The Big Idea</h2>
        <p className="big-quote">You put money in. The system grows it. You earn a share of the profits. The longer you stay, the more you earn.</p>
      </div>

      {/* Step by Step */}
      <div className="section">
        <h2>How the Money Flows</h2>

        <div className="flow-steps">
          <div className="flow-step">
            <div className="flow-num">1</div>
            <div>
              <h3>You Join a Family Pool</h3>
              <p>A Family Pool is like a group savings account. Anyone can create one or join an existing one. When you deposit money (ETH or FC), a small 5% fee goes to the main treasury. That fee helps grow the entire system.</p>
            </div>
          </div>

          <div className="flow-step">
            <div className="flow-num">2</div>
            <div>
              <h3>The AI Trades Automatically</h3>
              <p>A robot trader called the "Director" watches the market 24/7. It makes small, safe trades — selling tiny amounts of FC for ETH. It never sells too much at once (max 2% of the pool per trade) and pauses automatically if the market looks risky.</p>
            </div>
          </div>

          <div className="flow-step">
            <div className="flow-num">3</div>
            <div>
              <h3>Profits Get Split</h3>
              <p>The money earned from trades gets divided. Some goes to you as profit, some goes back into the pool to make it bigger. The split depends on how big the pool has grown (see the tiers below).</p>
            </div>
          </div>

          <div className="flow-step">
            <div className="flow-num">4</div>
            <div>
              <h3>The Pool Gets Deeper</h3>
              <p>The reinvested money makes the trading pool bigger. A bigger pool means more stable prices, which means bigger trades are possible, which means more profit. Growth feeds more growth.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tiers */}
      <div className="section">
        <h2>Profit Tiers</h2>
        <p>As the pool grows, your profit share goes up:</p>
        <div className="tier-table">
          <div className="tier-row tier-header">
            <span>Stage</span>
            <span>Pool Size</span>
            <span>Your Profit</span>
            <span>Goes Back to Pool</span>
          </div>
          {TIERS.map(t => (
            <div key={t.name} className="tier-row" style={{ borderLeftColor: t.color }}>
              <span>{t.icon} {t.name}</span>
              <span>{t.max === Infinity ? '$10M+' : t.max >= 1_000_000 ? '$' + (t.max/1_000_000) + 'M' : t.max >= 1_000 ? '$' + (t.max/1_000) + 'K' : '$' + t.max}</span>
              <span style={{ color: t.color, fontWeight: 700 }}>{t.profit}%</span>
              <span>{t.reinvest}%</span>
            </div>
          ))}
        </div>
        <p className="hint">Early on, everything goes back into the pool. As it grows, you keep more. At $10M+, you're keeping 80 cents of every dollar earned.</p>
      </div>

      {/* Safety */}
      <div className="section">
        <h2>Safety Features</h2>
        <div className="safety-grid">
          <div className="safety-item">
            <span className="safety-icon">🛡</span>
            <strong>2% max drain per trade</strong>
            <p>No single swap can remove more than 2% of the pool.</p>
          </div>
          <div className="safety-item">
            <span className="safety-icon">⏸</span>
            <strong>Auto-pause on high impact</strong>
            <p>If a trade would move the price more than 8%, everything stops.</p>
          </div>
          <div className="safety-item">
            <span className="safety-icon">⛽</span>
            <strong>Gas-positive only</strong>
            <p>No trade executes unless it earns more than the transaction fee.</p>
          </div>
          <div className="safety-item">
            <span className="safety-icon">🔒</span>
            <strong>40% wallet cap</strong>
            <p>The AI never sells more than 40% of the coins in the wallet.</p>
          </div>
          <div className="safety-item">
            <span className="safety-icon">⏱</span>
            <strong>Cooldown timers</strong>
            <p>Bigger trades wait longer before the next one runs.</p>
          </div>
          <div className="safety-item">
            <span className="safety-icon">📋</span>
            <strong>Full audit trail</strong>
            <p>Every trade is logged on-chain and verifiable on BaseScan.</p>
          </div>
        </div>
      </div>

      {/* Glossary */}
      <div className="section">
        <h2>Glossary</h2>
        <div className="glossary">
          {[
            ['FC (FractalCoin)', 'The digital coin itself'],
            ['ETH (Ethereum)', 'The currency used to buy/sell FC'],
            ['Base Network', 'The blockchain FC lives on — fast and cheap fees (built by Coinbase)'],
            ['Family Pool', 'A group investment pool anyone can join'],
            ['Director AI', 'The robot trader that runs 24/7'],
            ['Liquidity', 'How much money is in the trading pool'],
            ['Swap', 'Trading one coin for another'],
            ['Gas', 'A small fee for making transactions (pennies on Base)'],
            ['MetaMask', 'A digital wallet app used to connect to crypto apps'],
            ['Slippage', 'How much the price changes during a trade'],
            ['Uniswap', 'The decentralized exchange where FC is traded'],
            ['BaseScan', 'A website where you can verify any transaction on Base'],
          ].map(([term, def]) => (
            <div key={term} className="glossary-row">
              <span className="glossary-term">{term}</span>
              <span className="glossary-def">{def}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="section">
        <h2>Frequently Asked Questions</h2>
        <div className="faq-list">
          {[
            ['How much do I need to start?', 'As little as a few dollars in ETH. Gas fees on Base are only pennies.'],
            ['Can I lose money?', 'Like any investment, the value of FC can go up or down. The safety systems protect against sudden crashes, but crypto is volatile. Never invest more than you can afford to lose.'],
            ['When can I withdraw?', 'Anytime. There are no lock-up periods.'],
            ['Who controls the trading?', 'The Director AI trades automatically using pre-set rules built into the code. No human is manually trading.'],
            ['What are the fees?', '5% founder fee on Family Pool deposits. 0.3% Uniswap swap fee. Gas on Base is typically under $0.01.'],
            ['What\'s the total supply?', '21 million FC maximum. 50% mining, 30% deposits, 10% treasury, 10% founder.'],
          ].map(([q, a]) => (
            <div key={q} className="faq-item">
              <div className="faq-q">{q}</div>
              <div className="faq-a">{a}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Verify */}
      <div className="section">
        <h2>Verify Everything</h2>
        <p>Don't trust, verify. All contracts are public on BaseScan:</p>
        <div className="contract-info">
          <div className="contract-row">
            <span className="contract-label">FC Token:</span>
            <a href={`https://basescan.org/token/${FC_TOKEN}`} target="_blank" rel="noreferrer" className="contract-addr">{FC_TOKEN}</a>
          </div>
          <div className="contract-row">
            <span className="contract-label">Family Pools:</span>
            <a href={BASESCAN_POOLS} target="_blank" rel="noreferrer" className="contract-addr">{FC_POOLS}</a>
          </div>
        </div>
      </div>
    </div>
  );
}
