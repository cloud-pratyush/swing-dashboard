# Swing Dashboard

Daily swing-trade screener. A GitHub Action runs before the US open (~07:30 ET) on the previous close,
writes JSON, and publishes a static dashboard to GitHub Pages.

```
config.yaml        tickers, thresholds, risk, gating (edit here)
src/               data, indicators, setups, regime, score, build
site/              index.html + app.js + style.css (reads site/data/*.json)
.github/workflows  daily.yml (cron + deploy)
```

## Run locally
```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest -q
python -m src.build            # writes site/data/*.json
python -m http.server 8000 -d site   # open http://localhost:8000
```

## Publish
```powershell
git init; git add .; git commit -m "Initial dashboard"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
Then in the repo: **Settings > Pages > Source: GitHub Actions**, and run
**Actions > Daily scan and deploy > Run workflow** once. The site appears at
`https://<you>.github.io/<repo>/`.

## Notes
- Signals use end-of-day bars; trade the next session. Not financial advice.
- Pages is public. Don't put anything private in this repo.
- Scheduled runs can start late; the page shows the data date and warns when it looks stale.
