# Contributing to Orion

Thanks for your interest in contributing to Orion! This guide will help you get set up and familiar with the codebase.

---

## Architecture Overview

Before making any changes, please read [architecture.md](architecture.md) to understand the system design. Orion follows a **decoupled, distributed architecture**: changes in one layer can have non-obvious effects across the system.

The key architectural design choices to keep in mind:

- **The API server is stateless.** It delegates heavy processing by enqueuing jobs into Redis BullMQ and relays real-time events via SSE.
- **Workers are independent.** Each worker type (download, transcode, subtitle, finalize) processes jobs from its own BullMQ queue.
- **The BullMQ FlowProducer DAG** orchestrates post-download processing: `finalize` runs once both `transcode` and `subtitle` children succeed.
- **Redis is the single source of truth** for in-flight state (`orion:active_media:<fileId>`). SQLite stores persistent data (metadata, progress, downloads).
- **Type contracts are shared** across the API and workers via `src/main/types/`. When updating job payloads, events, or models, make sure they remain compatible across all consumers.

---

## Project Structure

```
orion/
├── src/
│   ├── main/                    # Backend (TypeScript)
│   │   ├── server.ts            # Express API entry point
│   │   ├── routes/
│   │   │   ├── api.ts           # REST API endpoints
│   │   │   └── stream.ts        # HLS & subtitle static file serving
│   │   ├── workers/
│   │   │   ├── index.ts         # Worker fleet entry point & CLI routing
│   │   │   ├── downloadWorker.ts
│   │   │   ├── transcodeWorker.ts
│   │   │   ├── subtitleWorker.ts
│   │   │   └── finalizeWorker.ts
│   │   ├── db/                  # SQLite repositories (WAL mode)
│   │   │   ├── index.ts         # DB initialization & schema
│   │   │   ├── metadata.ts      # Movie/show/episode metadata cache
│   │   │   ├── progress.ts      # Watch progress tracking
│   │   │   ├── downloads.ts     # Download records
│   │   │   └── subtitles.ts     # Subtitle preferences
│   │   ├── types/               # Shared type contracts
│   │   │   ├── models.ts        # Domain entities & API response types
│   │   │   ├── jobs.ts          # BullMQ job payload & result DTOs
│   │   │   ├── events.ts        # Redis Pub/Sub event types
│   │   │   ├── clients.ts       # External API client types
│   │   │   └── errors.ts        # Error types
│   │   ├── queues/              # BullMQ queue definitions & FlowProducer
│   │   ├── clients/             # External API clients (Cinemeta, Metahub, etc.)
│   │   ├── config/              # Environment config & constants
│   │   ├── sse/                 # Server-Sent Events relay
│   │   └── utils/               # Shared utilities
│   └── renderer/                # Frontend (Vanilla JS PWA)
│       ├── App.js               # SPA entry point & router
│       ├── state/               # Reactive store (Store.js)
│       ├── views/               # Page views
│       ├── components/          # Reusable UI components
│       ├── services/            # API client & SSE service
│       └── utils/               # Frontend utilities
├── architecture.md              # Full system architecture documentation
├── tests/                       # Automated Vitest test suite
│   ├── unit/                    # Unit tests (db, workers, codec, clients, frontend)
│   ├── integration/             # Integration tests (REST API, streaming routes)
│   └── setup.ts                 # Global test environment configuration
├── docker-compose.yml           # Production deployment
├── Dockerfile
├── tsconfig.server.json         # Backend TypeScript config
├── vite.config.js               # Frontend Vite + PWA config
├── vitest.config.ts             # Vitest test runner configuration
└── .env.example                 # Environment configuration template
```

---

## Development Setup

### Prerequisites

| Dependency | Version | Notes |
|:---|:---|:---|
| **Node.js** | `≥ 22.5.0` | Required for `node:sqlite` and `--env-file-if-exists` |
| **Redis** | `7.x` | Running on `localhost:6379` |
| **FFmpeg & FFprobe** | Latest | Available in `$PATH` |
| **ffsubsync** | Latest | Install via `pip install ffsubsync` |

### Getting Started

```bash
# Clone and install
git clone https://github.com/guyavrhm/orion.git
cd orion
npm install

# Configure environment
cp .env.example .env
# Edit .env - at minimum, set TORRENT_MOVIE_PROVIDER and TORRENT_SHOW_PROVIDER

# Start everything in dev mode (API + all workers)
npm run dev:all
```

### Running Individual Processes

For targeted development, you can run components separately:

```bash
# API server only
npm run dev:api

# All workers
npm run dev:workers

# Individual workers
npm run dev:worker:download
npm run dev:worker:transcode
npm run dev:worker:subtitle
npm run dev:worker:finalize

# Frontend dev server (Vite HMR)
npm run dev
```

### Type Checking

```bash
npm run typecheck
```

This runs `tsc -p tsconfig.server.json --noEmit` in strict mode to ensure backend code is type-safe.

---

## Coding Guidelines

### Backend (TypeScript)

- **Strict TypeScript**: the backend compiles with `"strict": true`. Try to avoid `any` types without a clear reason.
- **Type contracts first**: if you're adding or modifying a job payload, event, or API response, please update the corresponding type definition in `src/main/types/` first. These types are shared across the API server and all workers.
- **Canonical file IDs**: media identifiers follow the canonical format: `{imdbId}` for movies, `{imdbId}_s{season}_e{episode}` for episodes.
- **Keep the API server lightweight**: the Express process handles routing and events, while long-running work is delegated to BullMQ workers.
- **Redis for ephemeral state, SQLite for persistent state**: in-flight download tracking goes in Redis (with TTL). Completed records, metadata, and user progress go in SQLite.
- **SQLite concurrency**: the database runs in WAL mode for multi-process safety. Use the existing repository pattern in `src/main/db/` for database operations.
- **Worker isolation**: workers are designed to be stateless and idempotent. All inter-process communication goes through Redis (BullMQ jobs or Pub/Sub events).

### Frontend (Vanilla JS)

- **No frameworks currently**: the frontend is vanilla JavaScript by design. Introducing a framework (React, Vue, etc.) would require a complete rewrite of `src/renderer/`.
- **Normalized store pattern**: all state flows through `Store.js`. Metadata, progress, and downloads are kept in separate normalized caches. Don't duplicate data across caches.
- **SSE-driven updates**: real-time UI updates come from the `/events` SSE stream. Don't poll the API for status changes.

### General

- **Preserve existing comments and docstrings** unless they are directly affected by your change.
- **Keep commits focused**: one logical change per commit. Separate refactors from feature work.
- **Automated Tests**: Orion has a comprehensive Vitest test suite covering database repositories, worker pipelines, FFmpeg/codec inspection, external API clients, REST API endpoints, and the frontend store. Please run `npm test` before submitting changes.

---

## Testing Guidelines

Orion uses [Vitest](https://vitest.dev/) for unit and integration testing.

```bash
# Run all tests once
npm test

# Run tests in watch mode during development
npm run test:watch

# Run tests with coverage reports
npm run test:coverage
```

### Writing Tests
- **Unit Tests**: Place unit tests next to their respective layer under `tests/unit/{db,workers,codec,clients,frontend}/`.
- **Integration Tests**: Place HTTP route and server integration tests in `tests/integration/`.
- **Isolation**: SQLite tests run against temporary databases with WAL mode and `PRAGMA busy_timeout = 5000;`. Please clean up test tables in `beforeEach`/`afterEach`.
- **Mocking**: Mock external dependencies (FFmpeg child processes, Redis BullMQ queues, fetch endpoints) using `vi.spyOn` or `vi.mock`.
- **Updating Tests & Architecture Docs**: When updating system contracts or data flows (such as database schemas, BullMQ job payloads, REST API responses, or frontend store state), please update the matching tests and [architecture.md](architecture.md) so everything stays in sync.

---

## Making Changes

### 1. Fork & Branch

```bash
git checkout -b your-feature-name
```

Use descriptive branch names like `fix/dead-stream-timeout`, `feat/offline-downloads`, or `refactor/subtitle-scoring`.

### 2. Develop

- Run `npm run typecheck` frequently to catch type errors early.
- Run `npm run test:watch` to get instant feedback on changes.
- Use `npm run dev:all` for full-system development, or run individual workers when focused on a specific pipeline stage.
- Watch the terminal output for Redis Pub/Sub events and BullMQ job lifecycle logs to verify your changes.

### 3. Verify

Before submitting your pull request:

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` passes all tests
- [ ] Tests and `architecture.md` are updated if any system contracts, schemas, or pipelines changed
- [ ] `npm run build:all` succeeds
- [ ] Manual testing confirms any end-to-end features or UI additions
- [ ] No regressions in existing functionality

### 4. Submit a Pull Request

- Provide a clear description of **what** changed and **why**.
- Reference any related issues.
- If your change touches the worker pipeline or data flow, briefly explain how it fits into the existing architecture.
- If your change adds or modifies API endpoints, include the request/response format.

---

## Areas for Contribution

Check the [Roadmap](README.md#roadmap) in the README for planned features. Some other areas where contributions are welcome:

- **Additional Tests**: expanding edge-case coverage across workers, transcode profiles, and UI views
- **Documentation**: improving inline code comments, API docs, or the architecture guide
- **Bug fixes**: check [open issues](https://github.com/guyavrhm/orion/issues) for reported problems

---

## Questions?

If you're unsure about an approach or want to discuss a larger change before implementing it, open a [Discussion](https://github.com/guyavrhm/orion/discussions) or comment on the relevant issue.
