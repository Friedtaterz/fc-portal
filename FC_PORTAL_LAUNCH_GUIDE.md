# FC Portal — Launch Guide
### 3 Steps to Go Live

---

## STEP 1: Install & Test Locally

Open a terminal in the `fc-portal` folder and run:

```
npm install
npm run dev
```

Opens at **http://localhost:3200**

Check that:
- [x] Dashboard shows live FC price and pool data
- [x] "Connect Wallet" works with MetaMask
- [x] Progress bar shows the current tier
- [x] Buy/Sell page links open Uniswap correctly
- [x] How It Works page reads clearly
- [x] Looks good on mobile (resize your browser)

---

## STEP 2: Build for Production

```
npm run build
```

This creates a `dist/` folder with your production-ready site.

---

## STEP 3: Deploy to Vercel (Free)

### Option A: Vercel CLI (fastest)

```
npm install -g vercel
vercel
```

Follow the prompts:
1. **Set up and deploy?** → Yes
2. **Which scope?** → Your account
3. **Link to existing project?** → No
4. **Project name?** → fractalcoin-portal (or whatever you want)
5. **Framework?** → Vite
6. **Build command?** → npm run build
7. **Output directory?** → dist

Done. Vercel gives you a URL like `fractalcoin-portal.vercel.app`

### Option B: Vercel Dashboard (no CLI)

1. Go to [vercel.com](https://vercel.com) and sign up (free, use GitHub)
2. Click **"Add New" → "Project"**
3. Import your GitHub repo (push fc-portal to GitHub first)
4. Framework: **Vite**
5. Click **Deploy**

### Option C: Netlify (also free)

1. Go to [netlify.com](https://netlify.com)
2. Drag the `dist/` folder onto the page
3. Done. Instant URL.

---

## OPTIONAL: Custom Domain

After deploying to Vercel or Netlify:

1. Buy a domain (Namecheap, GoDaddy, Google Domains — ~$10/year)
2. In Vercel: Settings → Domains → Add your domain
3. Update DNS to point to Vercel (they give you instructions)
4. SSL is automatic and free

Suggested names: `fractalcoin.xyz`, `fctoken.io`, `fractalcoin.app`

---

## What's Included

| Page | What It Shows |
|------|--------------|
| **Dashboard** | Live FC price, pool stats, wallet balance, progress bar, quick links |
| **Family Pools** | Pool details, tier table, how to join (step by step), contract addresses |
| **Buy / Sell** | Uniswap links, your holdings, step-by-step buy guide, add token to MetaMask, trading rules |
| **How It Works** | Plain-English explanation, flow chart, safety features, glossary, FAQ |

---

## How It Works (Technical)

- **No backend** — reads directly from Base chain via RPC
- **No database** — wallet IS the login (MetaMask)
- **Auto-refresh** — polls chain data every 15 seconds
- **ETH price** — fetched from CoinGecko API
- **Mobile-ready** — responsive design works on all screens
- **Fast** — Vite build, tiny bundle, no heavy dependencies

---

## Summary

```
npm install          ← install dependencies
npm run dev          ← test locally at localhost:3200
npm run build        ← build production site
vercel               ← deploy (free, instant URL)
```

That's it. 3 commands to test, 1 command to go live.
