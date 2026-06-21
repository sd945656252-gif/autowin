# JIYING Local Preview

JIYING is a local-first AI workflow canvas. The current development target is:

- Real-time preview while editing code.
- Local PostgreSQL persistence.
- Redis-backed workflow queue.
- One LAN URL that other computers can open on the same network.
- A Podman packaging path that can later become a desktop app, installer, or VPS deployment.

## Requirements

- Podman Desktop or Podman CLI with a running `podman machine`
- Windows PowerShell

Node.js is only required if you want to run outside Podman.

## Start Local Development Preview

```powershell
podman machine start
podman compose up --build -d
```

For daily realtime preview after the first setup, use the helper script:

```powershell
.\scripts\start-podman-dev.ps1
```

For a double-click launcher from Windows Explorer, use:

```text
Start JIYING.cmd
```

It starts the full local stack through the existing Podman workflow and then opens the active preview URL automatically.

You can also pass a preview port:

```text
Start JIYING.cmd 3100
```

That keeps the frontend preview URL aligned with the actual launcher port while still starting the backend, PostgreSQL, and Redis together.

The launcher builds the shared development image once and reuses it for web, worker, and migrations, which reduces repeated Podman startup work.

Use `.\scripts\start-podman-dev.ps1 -Build` after dependency or Dockerfile changes.

Open:

```text
http://localhost:3000/ (or the next available port chosen by the launcher)
```

This starts:

- `jiying-web` on the selected preview port, starting from `3000`
- `postgres` on host port `15432`, while containers use `postgres:5432`
- `redis` on host port `16379`, while containers use `redis:6379`

Source code is mounted into the container, so frontend/backend changes can be tested without rebuilding most of the time.

The helper script also protects the active preview port. If an old local `tsx apps/api/src/server.ts` process is still holding that port, it stops that stale process so the browser connects to the Podman backend and Podman PostgreSQL. If another unknown process owns the port, the script prints the PID and command line instead of silently serving the wrong backend.

Before printing `JIYING is ready`, the helper also checks that the API health endpoint is served by the container runtime, the web preview opens, and host ports `15432`/`16379` are reachable for PostgreSQL and Redis.

`podman compose up` also runs a one-shot `migrate` service before `jiying-web` and `jiying-worker`. It applies existing Prisma migrations with `prisma migrate deploy`; it does not create migrations and it does not run seed data. When you change `prisma/schema.prisma`, create the migration manually during development, then restart Compose. Initial/admin seed data remains a manual step with `npm run db:seed`.

To confirm the local realtime preview is ready after starting Podman, run:

```powershell
npm.cmd run dev:check
```

This check verifies that `/api/health` is being served by the container backend, not a stale local Node process.

For a faster check without TypeScript lint:

```powershell
npm.cmd run dev:check -- -SkipLint
```

By default, `dev:check` treats Podman CLI connection failures as warnings because the app can still be reachable through the Windows preview forwarder. When you specifically want to fail on Podman machine/container-list problems, run:

```powershell
npm.cmd run dev:check -- -StrictPodman
```

To include a headless Edge/Chrome console check for `/` and `/pipeline`:

```powershell
npm.cmd run dev:check:browser
```

The browser check automatically chooses a free Chrome DevTools port. Set `BROWSER_PATH` if Edge or Chrome is installed in a non-standard location, or set `BROWSER_CONSOLE_CHECK_TIMEOUT_MS=30000` if your machine needs more time to launch the browser. Browser automation failures are reported as warnings; API, Web, Prisma, and container-runtime checks still decide whether realtime development is ready.

If the warning says the browser exited before opening DevTools, run the command from an ordinary PowerShell desktop session and set `BROWSER_PATH` to the full path of `msedge.exe` or `chrome.exe`.

If `dev:check` reports that `localhost:3000` is owned by the local JIYING API process, rerun:

```powershell
.\scripts\start-podman-dev.ps1
```

That restores the realtime preview to the Podman stack.

If you already have data in a Windows PostgreSQL service on `localhost:5432`, migrate it once after starting Podman PostgreSQL:

```powershell
.\scripts\migrate-local-postgres-to-podman.ps1
```

## Share On The Same LAN

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\share-lan.ps1
```

The script prints a URL like:

```text
http://192.168.1.23:3000
```

Other computers on the same Wi-Fi/Ethernet network can open that URL in a browser.

If they cannot connect, allow inbound TCP port `3000` through Windows Firewall on the host machine.

LAN sharing is only for devices on the same network. A link like `http://192.168.x.x:3000` will not work for people outside your network.

## Share With Anyone On The Internet

For a real public link, deploy JIYING to a server or platform with a public domain. Recommended path:

1. Use a cloud PostgreSQL database, not a database on your personal computer.
2. Deploy the Podman Compose app to a small VPS or container host.
3. Point a domain to it, for example `https://jiying.example.com`.
4. Set:

```env
PUBLIC_APP_URL=https://jiying.example.com
APP_URL=https://jiying.example.com
```

For temporary public testing, a tunnel such as Cloudflare Tunnel or ngrok can expose your local Podman app. This is convenient but less stable than a proper server deployment.

## Google Login

Google login requires OAuth credentials from Google Cloud Console. It will not work until these variables are set:

```env
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

In Google Cloud Console, create an OAuth Client for a Web application and add this authorized redirect URI:

```text
${PUBLIC_APP_URL}/api/auth/google/callback
```

Examples:

```text
http://localhost:3000/api/auth/google/callback
http://192.168.1.23:3000/api/auth/google/callback
https://jiying.example.com/api/auth/google/callback
```

Important: for people outside your LAN, use an HTTPS public domain. Google OAuth is much more reliable with a stable HTTPS callback URL.

## Account Checks

Profile settings are persisted in PostgreSQL through `/api/auth/profile` and `/api/auth/password/change`. To verify nickname, preset/custom avatar, password changes, and primary-admin access:

```powershell
npm.cmd run account:smoke
```

To sync existing users listed in `PRIMARY_ADMIN_EMAILS` to active administrator accounts:

```powershell
npm.cmd run account:sync-primary-admins
```

The sync command does not create new accounts; it only promotes matching existing users.

## Production-Like Podman Package

Build and run the production-style image. First copy `.env.production.example` to `.env.production` and replace the placeholders.

```powershell
podman compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

This builds the frontend and backend into `dist/`, runs existing Prisma migrations through the independent `migrate` Compose service, and serves the compiled app from Node. The web and worker containers do not run migrations themselves.
More details are in `docs/production-deploy.md`.

## API Provider Setup

Use the local setup wizard to add text, image, or video provider keys without editing JSON manually:

```powershell
npm run api:setup
podman compose up --build -d
```

The wizard writes `config/api-providers.local.json`. That file is ignored by Git and imported by the backend on startup, then API keys are encrypted before being stored in PostgreSQL. Do not share that file.

## Environment

Copy `.env.example` to `.env` and adjust values as needed.

Important variables:

- `GEMINI_API_KEY`: optional for UI preview; required for Gemini-powered generation.
- `APP_URL`: server-side base URL.
- `PUBLIC_APP_URL`: URL shared with other devices, for example `http://192.168.1.23:3000`.
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`: required for Google one-click login.
- `ENCRYPTION_KEY`: replace before sharing real API keys.
- `DATABASE_URL`: local Prisma/PostgreSQL connection.
- `REDIS_URL`: local BullMQ/Redis connection.

## Cleanup

To remove generated development artifacts only:

```powershell
npm run clean
```

To also remove local uploads, storage, backups, and the Redis dump file:

```powershell
npm run clean:local-data
```

The second command deletes user data as well, so use it only when you intentionally want a full local reset.

## Showcase Video Transcoding

Featured/showcase video uploads are stable by default and do not require ffmpeg:

```env
SHOWCASE_UPLOAD_MAX_MB=1024
SHOWCASE_TRANSCODE_ENABLED=false
```

Featured work uploads are capped at 1GB. The browser rejects larger files before upload, and the backend also caps `SHOWCASE_UPLOAD_MAX_MB` at `1024` even if the environment is misconfigured higher. When transcoding remains `false`, uploaded videos are validated and stored as original files. This is the default for local development so a missing ffmpeg binary cannot break uploads. After upload, the backend publishes a showcase update event and open home pages refresh their showcase list through SSE.

Production images include ffmpeg. To normalize showcase uploads to web-optimized MP4, first verify the production container has both binaries:

```powershell
podman compose --env-file .env.production -f docker-compose.prod.yml exec -T jiying-web ffmpeg -version
podman compose --env-file .env.production -f docker-compose.prod.yml exec -T jiying-web ffprobe -version
```

Then enable:

```env
SHOWCASE_TRANSCODE_ENABLED=true
```

If transcoding is enabled but ffmpeg or ffprobe is unavailable, or if a transcode fails, the upload falls back to the original file instead of returning an unclear 500. The failure reason is recorded in `ShowcaseWork.metadata.transcode` and `MediaAsset.metadata` for diagnosis. The developer system health endpoint also reports `showcaseTranscode` status.

## Verification

```powershell
npm.cmd run lint
npx.cmd prisma validate
npm.cmd run build
Invoke-WebRequest http://localhost:3000/ -UseBasicParsing
```

Core production-asset workflow regression checks:

```powershell
npm.cmd run workflow:smoke:production-assets
```

This runs the video Slash, editing Slash, archived-reference, archive lifecycle, version lifecycle, stale review, media-stream access, and reference-asset access smoke tests.

You can also include that suite in the development environment check:

```powershell
npm.cmd run dev:check:assets
```

Podman checks:

```powershell
podman compose ps
podman compose logs --tail=100 jiying-web
```

## Packaging Roadmap

The current best packaging path is Podman first:

1. LAN URL for same-network testing.
2. Production Podman Compose for local deployable packages.
3. Optional public tunnel or VPS deployment when remote users outside LAN need access.
4. Later desktop shell with Electron or Tauri that launches or connects to the local service.

Desktop packaging should come after the web app and local service are stable, because the desktop shell should be a wrapper, not a second implementation.

## Database Recommendation

For one developer or LAN testing, Podman PostgreSQL is fine.

For multiple real users, use cloud PostgreSQL. Recommended options:

- Supabase Postgres: easiest dashboard and backups for early-stage apps.
- Neon Postgres: good serverless Postgres option for web apps.
- Railway Postgres: simple if the app is also hosted on Railway.

Current recommendation for JIYING: Supabase Postgres. It is straightforward to inspect data, configure backups, and later add storage/auth integrations if needed.

If you insist on local multi-user usage, keep exactly one host machine running Podman and let everyone connect to that host. Do not let every user's computer run its own database unless you intentionally want separate data islands.
