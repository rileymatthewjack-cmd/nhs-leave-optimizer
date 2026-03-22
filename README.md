# NHS Leave Optimizer

Maximize your annual leave from your NHS IMT rota. Upload your rota CSV, lock must-have leave days, and let the optimizer find the best strategy for maximum consecutive time off.

## Features

- **Upload rota** — auto-parses CSV exports from HealthRoster, Allocate, CLWRota, and similar NHS rostering systems
- **Smart shift detection** — recognises common NHS shift terminology (day, night, long day, rest, on-call, etc.) and time-range formats
- **Manual editing** — click-and-drag calendar painting with shift type palette
- **Template patterns** — pre-built IMT rota patterns (Mon–Fri, on-call blocks, mixed cycles)
- **Lock must-have leave** — pin holidays you've already booked before optimizing
- **Greedy optimizer** — maximizes consecutive days off by "bridging" gaps between existing rest days
- **UK bank holidays** — 2025–2027 bank holidays built in
- **Results dashboard** — stats, streaks breakdown, and full calendar view

---

## Quick Start (run locally)

You need **Node.js 18+** installed. Check with `node --version`.

```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm run dev
```

Opens at `http://localhost:5173`. Changes hot-reload instantly.

```bash
# 3. Build for production
npm run build
```

Creates an optimized `dist/` folder ready to deploy.

---

## Deploy to Vercel (free, recommended)

This is the fastest way to get a live URL you can share.

### Option A: Via GitHub (auto-deploys on push)

1. **Push this folder to a GitHub repo:**
   ```bash
   cd nhs-leave-optimizer
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create nhs-leave-optimizer --public --push
   ```
   (Or create the repo on github.com and push manually.)

2. **Go to [vercel.com](https://vercel.com)** and sign in with GitHub.

3. **Click "Add New Project"** → select your `nhs-leave-optimizer` repo.

4. Vercel auto-detects Vite. Click **Deploy**. Done.

5. You'll get a URL like `nhs-leave-optimizer.vercel.app`. Every time you push to `main`, it redeploys automatically.

### Option B: Via Vercel CLI (deploy from terminal)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (follow the prompts)
vercel

# Deploy to production
vercel --prod
```

---

## Deploy to Netlify (also free)

1. **Build locally:**
   ```bash
   npm run build
   ```

2. **Go to [app.netlify.com](https://app.netlify.com)** → "Add new site" → "Deploy manually".

3. **Drag the `dist/` folder** into the browser window. Done.

Or use the Netlify CLI:
```bash
npm i -g netlify-cli
netlify deploy --dir=dist --prod
```

---

## Deploy to GitHub Pages (free)

1. In `vite.config.js`, set the base to your repo name:
   ```js
   base: '/nhs-leave-optimizer/',
   ```

2. Install the deploy plugin:
   ```bash
   npm install -D gh-pages
   ```

3. Add to `package.json` scripts:
   ```json
   "deploy": "npm run build && gh-pages -d dist"
   ```

4. Run:
   ```bash
   npm run deploy
   ```

5. Enable GitHub Pages in repo Settings → Pages → Source: `gh-pages` branch.

---

## Custom Domain (optional)

On Vercel or Netlify, go to your project settings → Domains → add your custom domain. Both services handle HTTPS automatically.

For example: `leave.yourdomain.com`

---

## Project Structure

```
nhs-leave-optimizer/
├── index.html              # HTML entry point
├── package.json            # Dependencies & scripts
├── vite.config.js          # Vite configuration
├── .gitignore
├── README.md               # This file
└── src/
    ├── main.jsx            # React entry point
    ├── App.jsx             # App wrapper
    └── NHSLeaveOptimizer.jsx  # Main application component
```

---

## Rota CSV Format

The parser handles several formats automatically:

### Format 1: Date per row
```csv
Date,Shift
05/08/2026,Day
06/08/2026,Night
07/08/2026,Rest
```

### Format 2: Dates across columns (weekly grid)
```csv
Name,05/08/2026,06/08/2026,07/08/2026,...
Dr Smith,Day,Night,Rest,...
```

### Format 3: Raw pattern (no dates)
```csv
Day,Day,Day,Day,Day,Off,Off,Long,Night,Night,Rest,Rest,Off,Off
```

### Recognised shift keywords
| Shift Type | Keywords |
|---|---|
| Day | day, d, ward, clinic, early, am, 9-5, standard, normal |
| Long Day | long, ld, 12hr, on call, oncall, extended |
| Night | night, n, noc, late, twilight, evening |
| Rest | rest, r, post, pn, zero, recovery, post-night |
| Off | off, o, free, nil, none, x, - |
| Annual Leave | al, annual leave, leave, a/l, holiday |
| Bank Holiday | bh, bank holiday, ph, public holiday |

Time ranges like `08:00-20:00` are also auto-detected.

---

## Tech Stack

- **React 18** — UI framework
- **Vite 6** — build tool and dev server
- **Vanilla CSS** — no external CSS framework (all styles inline)
- **Zero backend** — everything runs client-side in the browser

---

## Licence

MIT — do what you like with it.
