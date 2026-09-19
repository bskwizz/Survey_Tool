# Deployment Guide

This guide covers: (1) deploying the backend, (2) deploying the two static
frontends, and (3) sideloading/publishing the PowerPoint add-in.

## 1. Backend deployment

**Primary recommendation: Azure App Service (Linux, Node 18+ runtime).**
Given the Microsoft-native context of this project (a PowerPoint add-in),
Azure App Service keeps the whole stack in one ecosystem, integrates
cleanly with Azure Static Web Apps for the frontends, and supports easy TLS
+ custom domains, which the add-in's manifest requires (HTTPS only).

### Steps (Azure App Service)

1. Create a resource group and an App Service plan (Linux, B1 or higher):
   ```bash
   az group create -n classroom-survey-rg -l eastus
   az appservice plan create -g classroom-survey-rg -n classroom-survey-plan --is-linux --sku B1
   az webapp create -g classroom-survey-rg -p classroom-survey-plan -n classroom-survey-api --runtime "NODE:18-lts"
   ```
2. Configure app settings (mirrors `.env.example` - set real values, never
   commit them):
   ```bash
   az webapp config appsettings set -g classroom-survey-rg -n classroom-survey-api --settings \
     NODE_ENV=production \
     JWT_SECRET="<generate-a-long-random-value>" \
     PARTICIPANT_TOKEN_SECRET="<generate-a-long-random-value>" \
     PUBLIC_BASE_URL="https://classroom-survey-api.azurewebsites.net" \
     CORS_ORIGIN="https://<your-static-web-app-domain>" \
     STORAGE_ENGINE=json \
     SYNTHESIS_PROVIDER=mock
   ```
   (Switch `SYNTHESIS_PROVIDER=openai` and set `AI_API_KEY` /
   `AI_API_BASE_URL` / `AI_MODEL` once you have a real key. Switch
   `STORAGE_ENGINE=sqlite` if you want SQLite persistence - see note below
   on persistent storage.)
3. Deploy via `git push` to the Azure remote, GitHub Actions, or `az webapp
   up` from `backend/`.
4. **Persistent storage note:** App Service's local filesystem is not
   guaranteed durable across restarts/scale events. For the default
   `STORAGE_ENGINE=json` or `STORAGE_ENGINE=sqlite`, mount an Azure Files
   share to the `DATA_DIR` path (App Service > Configuration > Path
   mappings) so `data/db.json` (or `db.sqlite3`) survives restarts. For a
   fully production-grade setup, consider swapping in a
   `PostgresRepository` implementing the same `Repository` interface
   (see `backend/src/db/repository.js`) backed by Azure Database for
   PostgreSQL - the rest of the app requires zero changes.
5. **Alternative primary options that are equally valid** (simpler to get
   started with, less Microsoft-native): Render.com or Fly.io both support
   one-command Node.js deploys with automatic HTTPS and are good choices if
   you don't need Azure-specific integration.
6. Ensure Socket.IO's WebSocket upgrade is allowed (App Service: enable
   "Web sockets" under Configuration > General settings).

## 2. Frontend deployment (participant app + instructor dashboard)

**Recommendation: Azure Static Web Apps** (one instance per app, or both
served from the same Static Web App under different routes).

1. Push this repo to your own GitHub repository (see root README for the
   `git remote add` + `git push` steps).
2. In the Azure Portal, create a Static Web App, connect it to your GitHub
   repo, and set:
   - App location: `/frontend/participant` (create a second Static Web App
     or a second workflow job for `/frontend/instructor-dashboard`)
   - Output location: `` (no build step - these are plain static files)
3. Update `config.js` in each frontend (`BACKEND_BASE_URL`) to point at your
   deployed backend's HTTPS URL if the frontend and backend are on
   different origins. Also update backend's `CORS_ORIGIN` to match.
4. **Alternative:** Vercel or Netlify work equally well for static hosting
   and are simpler if you don't need Azure-specific integration - just point
   either at the respective frontend folder with no build command.
5. **SPA fallback routing:** the participant app is a single `index.html`
   that reads `window.location.pathname` (`/join/:shortCode`) client-side
   (see `frontend/participant/app.js`). Configure your static host to
   rewrite all unmatched paths to `index.html` (Azure Static Web Apps:
   `staticwebapp.config.json` with a `navigationFallback` rule; Vercel/
   Netlify: a catch-all rewrite rule) so a fresh QR-code scan of
   `/join/AB12CD?q=...` doesn't 404.

## 3. PowerPoint Add-in: local dev, sideloading, and publishing

### Local HTTPS dev certs

Office Add-ins require HTTPS even in local development. Use Microsoft's
official tool:

```bash
npx office-addin-dev-certs install
```

This installs a locally-trusted self-signed certificate so
`https://localhost:3000` (or whatever port you serve the add-in's static
files + backend from) is trusted by your OS and by PowerPoint.

Serve `powerpoint-addin/` (taskpane.html/js/css, commands.html/js, manifest.xml,
assets/) over HTTPS on the same host referenced in `manifest.xml`
(`https://localhost:3000` placeholders - update to your real dev/prod host).

### Sideloading for local development

1. Open PowerPoint (desktop, Windows/Mac) or PowerPoint on the web.
2. Go to **Insert > My Add-ins > Upload My Add-in** (desktop) or
   **Insert > Add-ins > Upload My Add-in** (web).
3. Browse to your local `powerpoint-addin/manifest.xml` and upload it.
4. The "Live Survey" button should appear on the Home ribbon tab; clicking
   it opens the task pane.

### Publishing for real classroom use

1. Update every placeholder URL in `manifest.xml` (`https://localhost:3000/...`)
   to your deployed HTTPS URL (e.g. the Azure Static Web App or App Service
   URL hosting the add-in's static files).
2. Validate the manifest: `npx office-addin-manifest validate manifest.xml`.
3. Publish via the **Microsoft 365 admin center** (Settings > Integrated
   apps > Upload custom apps) for org-wide deployment to instructors, or
   distribute the manifest file directly for ad-hoc sideloading in smaller
   deployments.
4. For public AppSource distribution (optional, out of scope for a
   classroom-internal tool), you would additionally need to go through
   Microsoft's AppSource validation/publisher verification process.

### Reminder: Slide Show limitation

Communicate to instructors: the task pane (and thus "Refresh slide now")
only works in Normal/Editing view, or in "Browsed by an individual (window)"
presentation mode - not full-screen "Presented by a speaker" mode. See
`docs/ARCHITECTURE.md` section 7 for the full explanation.
