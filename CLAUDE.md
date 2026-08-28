# CLAUDE.md

Guidance for Claude Code when working in this repository.

`AGENTS.md` holds the product charter, privacy rules and long-term architecture
constraints — read it before any non-trivial change. This file covers how to
actually build, run and modify the code.

## What this is

OpenCord: a self-hosted Discord alternative. Three parts, one pnpm workspace.

| Package | What it is | Key entry points |
| --- | --- | --- |
| `shared/` | Zod protocol contract shared by client and server | `src/protocol.ts`, `src/mentions.ts`, `src/health.ts`, `src/release-manifest.ts` |
| `server/` | Fastify + WebSocket API on a VPS | `src/app.ts` (routes + WS), `src/database/repository.ts`, `src/database/migrations.ts`, `src/config.ts`, `src/voice.ts` |
| `client/` | Electron shell + statically exported Next.js UI | `electron/main.ts`, `src/components/client-app.tsx`, `src/shared/state.ts`, `src/hooks/use-server-connection.ts` |
| `deploy/` | Docker Compose, SSH installer, bundle build | `scripts/local-compose.mjs`, `compose.yml`, `Dockerfile.bundle`, `scripts/bootstrap.sh` |

Stack: TypeScript everywhere, Node ≥ 24, pnpm ≥ 11, Fastify, PostgreSQL in
production / PGlite locally, LiveKit for voice, Vitest for tests.

## Commands

```bash
pnpm install            # once; corepack picks the pinned pnpm
pnpm dev                # server (tsx watch) + Electron client
pnpm dev:server         # server only, http://127.0.0.1:3210
pnpm dev:client         # client only (expects a server already running)
pnpm docker:up          # production-like stack: postgres + server + livekit
pnpm docker:logs        # follow container logs
pnpm docker:down        # stop; keeps the database volume
pnpm test               # all workspaces, sequential
pnpm typecheck          # all workspaces
pnpm lint
```

Run a single package's tests with `pnpm --filter @opencord/server test`, and a
single file with `pnpm --filter @opencord/client test -- client-app.test.tsx`.

## Rules that bite if ignored

- **`shared/` must be built before anything consumes it.** Client and server
  import `@opencord/shared` from `dist/`, not from source. Most root scripts do
  `pnpm --filter @opencord/shared build` first — keep that ordering when adding
  scripts, and run it manually after editing `shared/src`.
- **Versions are locked in step.** `scripts/check-versions.mjs` requires the
  root, client, server and shared `package.json` versions to match *and*
  `BOOTSTRAP_VERSION` in `deploy/scripts/bootstrap.sh` to equal them. Bump all
  five together or `build`/`test`/`package:*` fail.
- **Protocol changes are a four-file move**: `shared/src/protocol.ts`, the
  server handler in `server/src/app.ts`, the client state in
  `client/src/shared/state.ts` / `client-app.tsx`, and `docs/protocol.md`.
- **Schema changes are append-only migrations.** Add a new
  `{ id: "0NN_name", sql }` entry at the end of the array in
  `server/src/database/migrations.ts`; never edit a shipped migration. The same
  SQL has to run on both PGlite and PostgreSQL.
- **UI strings are trilingual.** Every key added to
  `client/src/lib/i18n/en.ts` must also land in `ru.ts` and `zh.ts` —
  `client/tests/i18n.test.tsx` asserts parity.
- **No hot reload in the client.** `pnpm dev:client` is `pnpm build && electron .`
  (static Next.js export). Restart it after UI edits; the server reloads itself.
- **Secrets stay out of git.** `deploy/secrets/` and `deploy/.env` are generated
  by `local-compose.mjs` on `docker:up`. Never commit them, never log key
  material, never move a private key toward the server.

## Local runtime facts

- Server: `http://127.0.0.1:3210`, health at `/health`.
- Dev database: PGlite files in `server/.data/opencord`; attachments in
  `server/.data/attachments`. Deleting `server/.data` resets local state.
- Docker loop: only the server port is published; PostgreSQL stays internal,
  LiveKit is on `127.0.0.1:7882`. `ALLOW_INSECURE_FIRST_USER_OWNER=true` is set
  for dev/local Docker only — the first user to connect becomes owner.
- One Electron user-data directory equals one cryptographic identity. To test
  two users, launch a second instance with a separate user-data dir.

## Testing expectations

Vitest in every package; client tests use jsdom + Testing Library, Playwright
covers the packaged Electron app (`pnpm --filter @opencord/client test:electron`).
New work on authentication, permissions, migrations, message handling or the
installer needs tests — that is an `AGENTS.md` rule, not a suggestion.
