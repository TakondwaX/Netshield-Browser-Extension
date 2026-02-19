# NetShield Website

Landing page and live demo for the NetShield browser extension.

## Download

The `NetShield-Extension.zip` file in this folder contains the extension. Users can download it from the website and load it in Chrome via "Load unpacked" after extracting.

To refresh the zip after changes, run from the project root:
```powershell
Compress-Archive -Path manifest.json, popup.js, popup.css, popup.html, background.js, content.js, icons -DestinationPath website\NetShield-Extension.zip -Force
```

## Run locally

The site uses `fetch()` to load network info. Browsers may block this when opening `index.html` directly (`file://`). Use a local server:

```bash
# From the website folder:
npx serve .

# Or with Python:
python -m http.server 8000
```

Then open `http://localhost:3000` (serve) or `http://localhost:8000` (Python).

## Deployment & HTTPS

**Netlify** — Deploy the `website` folder. HTTPS is automatic. The `_headers` file adds security headers (HSTS, X-Frame-Options, etc.).

**Vercel** — Deploy the `website` folder. HTTPS is automatic. The `vercel.json` file adds the same security headers.

Both platforms enforce HTTPS by default, so your site will be served over TLS.

## Security

- **Meta tags** — `referrer`, `X-Content-Type-Options`, `X-UA-Compatible`
- **Server headers** (when deployed) — Strict-Transport-Security (HSTS), X-Frame-Options, Referrer-Policy, Permissions-Policy

## Contents

- **Hero** — Value proposition and extension mockup
- **Features** — IP, ISP/Location, Phishing Detection, Speed Test
- **Live Demo** — Fetches and displays your IP, ISP, speed, and location
- **Install** — Steps to load the extension in Chrome
