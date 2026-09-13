# Housing Decision Engine

Free buy-vs-rent decision tool for first-time homebuyers. Plain HTML/CSS/JS — no build step, no backend, no accounts. All calculations run in the browser.

## Structure

- `index.html` + `style.css` — landing page
- `app/` — the full tool (`index.html`, `script.js`, `style.css`)
- `assets/logo.png`
- `netlify.toml` — static hosting config (publish root = repo root)
- `test-engine.js` — loads the real `app/script.js` engine and runs Massachusetts-style scenarios with invariant checks (`node test-engine.js`, exits 1 on failure)

## Run locally

Open `app/index.html` directly in a browser, or from the `app/` folder run `serve.ps1` (Windows) and visit http://localhost:8000.

## Deploy

Netlify deploys automatically from the `main` branch on every push. No environment variables or functions are required.

## Cache-busting

When you change `app/script.js` or a stylesheet, bump the `?v=N` on its `<script>`/`<link>` tag in the matching HTML file — Netlify serves JS/CSS with a one-year cache.
