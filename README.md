<div align="center">

# Orion

### Self-Hosted Torrent Client and Media Server

*Searches, downloads, transcodes, syncs, and streams to any device.*

<img src="https://github.com/user-attachments/assets/d01f920b-c06b-4765-8913-b00460b8567c" alt="Orion Interface Preview" width="720">

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Vite PWA](https://img.shields.io/badge/Vite-PWA-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tests](https://img.shields.io/github/actions/workflow/status/guyavrhm/orion/ci.yml?branch=main&style=for-the-badge&label=Tests&logo=vitest&logoColor=white)](https://github.com/guyavrhm/orion/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

</div>

<br>

## What is Orion?

Orion is a lightweight self-hosted torrent client and media server built for reliable, automated media management and playback. 

Instead of relying on live torrent streaming with limited device compatibility, or complex setups involving multiple services, Orion handles the entire media lifecycle automatically, even on a low-spec server. Everything is fully prepared in advance for instant playback across multiple devices.

Orion is split into two distinct halves:
1. **The Engine (Backend):** Self-hosted on your server or computer. It automatically discovers and verifies torrent streams, manages downloads, fixes subtitles, transcodes media, and serves cached content to multiple clients.
2. **The Player (Universal PWA):** A lightweight web client that works on virtually any browser, phone, tablet, or smart TV.

> Queue up an entire season while you're at work or asleep. Once ready, open the app and play anywhere.

## Quick Start

### With Docker (Recommended)

```bash
# Clone
git clone https://github.com/guyavrhm/orion.git
cd orion

# Configure
cp .env.example .env
# Edit .env: set your torrent provider URLs (see Configuration below)

# Launch
docker compose up -d --build
```

Open `http://localhost:3000` (or `http://<your-server-ip>:3000`) in your browser on any device, or install it as a PWA.

### Local Development

<details>
<summary><strong>Prerequisites & setup</strong></summary>

**Requirements:**
- **Node.js** `v22.x` or later
- **Redis** running on `localhost:6379`
- **FFmpeg** & **FFprobe** installed and in `$PATH`
- **ffsubsync** installed via `pip install ffsubsync`

```bash
# Install dependencies
npm install

# Start API server + all background workers (dev mode)
npm run dev:all

# Or start the Vite frontend dev server separately for hot reload
npm run dev

# Run automated tests
npm test

# Run tests with coverage
npm run test:coverage
```

</details>

## Features


### Playback & Client
- **Universal Web App**: Cross-platform (iOS, Android, desktop, web) with synchronized watch progress, built-in search, and metadata integration.
- **Universal Two-Lane HLS Transcoding**: Supports modern and legacy video formats with H.264 stream-copy, adaptive HEVC/AV1 re-encoding, and multi-channel audio normalization.

### Torrent & Media Pipeline
- **Intelligent Torrent Engine**: Dynamic API scraping with automated stream selection, codec-aware priority ranking, dead swarm failover, and queue stall management with piece preservation.
- **Automated Subtitle Pipeline**: Multi-source fetching (embedded tracks + OpenSubtitles hash lookup), ffsubsync waveform alignment, RTL/BiDi rendering fixes, and algorithmic accuracy scoring.
- **Resilient Worker Architecture**: Redis-backed BullMQ DAG pipeline for concurrent transcoding/subtitles, automatic crash recovery, and state resumption.

### Storage & Self-Hosting
- **Smart Storage & LRU Eviction**: Configurable storage caps with automatic LRU eviction and instant raw-torrent cleanup post-transcode.
- **Private & Self-Hosted**: Zero telemetry, user-configured providers, and single-command deployment.

## How It Compares

All the power of a full media automation stack in a single app, without fragile live torrent streaming or complex multi-service setups.

| Feature | Live Torrent Streaming | The *Arr Stack + Plex | Orion |
| :--- | :--- | :--- | :--- |
| **Client Support** | Restricted (fails on iOS/Safari) | Native apps / Plex clients | **Universal (PWA on any device)** |
| **Stream Discovery** | Manual trial & error | Automated via Indexers | **Automated swarm health testing** |
| **Playback & Scrubbing** | Buffers; scrubbing often breaks | Instant (direct play) | **Instant (pre-transcoded HLS)** |
| **Subtitles** | Manual offset & broken RTL | Requires Bazarr + manual BiDi fixes | **Auto audio-sync & BiDi/RTL correction** |
| **Storage Model** | Manual deletion | Large NAS / manual cleanup | **Automatic LRU cache eviction** |
| **Setup Complexity** | Single app / web player | 5–7 containers + configs | **Single `docker compose up`** |

## Configuration

Create a `.env` file from the provided example (`cp .env.example .env`) and configure:

### Torrent Providers

| Variable | Description |
|:---|:---|
| `TORRENT_MOVIE_PROVIDERS` | Single or comma-separated API URL templates for movie streams |
| `TORRENT_SHOW_PROVIDERS` | Single or comma-separated API URL templates for show streams |
| `TORRENT_MOVIE_PROVIDER_API_KEYS` | Optional API key(s) (single global key, or comma-separated matching provider order) |
| `TORRENT_SHOW_PROVIDER_API_KEYS` | Optional API key(s) (single global key, or comma-separated matching provider order) |

> **Multi-Provider & Formats:** You can provide multiple comma-separated URLs to query multiple indexers concurrently. Endpoints can be standard Torznab/Newznab XML feeds or custom JSON APIs (Orion will dynamically scan the response to extract magnet links, seeders, and required metadata).

> *Users are responsible for ensuring their configured providers comply with local copyright laws. See the Legal Disclaimer below for more details.*

### Media & Storage

| Variable | Default | Description |
|:---|:---|:---|
| `MAX_STORAGE_GB` | `100` | Storage cap before LRU eviction kicks in |
| `SUBTITLE_LANGS` | `eng,spa` | Comma-separated subtitle languages (ISO 639-2 canonical codes) |

### Worker & Queue Concurrency

| Variable | Default | Description |
|:---|:---|:---|
| `CONCURRENCY_DOWNLOAD` | `2` | Number of concurrent active torrent downloads |
| `CONCURRENCY_TRANSCODE_FAST` | `1` | Fast lane worker capacity (H.264 direct stream-copy) |
| `CONCURRENCY_TRANSCODE_HEAVY` | `1` | Heavy lane worker capacity (HEVC / AV1 / 10-bit re-encoding) |
| `CONCURRENCY_SUBTITLE` | `1` | Number of concurrent subtitle fetch & sync jobs |
| `CONCURRENCY_FINALIZE` | `1` | Number of concurrent finalization & SQLite registration jobs |

## Roadmap

Contributions and ideas are welcome! Here's what's on the horizon:

- **Offline PWA Downloads** - Allow users to locally save transcoded media directly to their devices (via the browser) for a fully offline experience, perfect for flights or commutes.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Legal Disclaimer

*Orion is an open-source, self-hosted personal media server application. It does not host, index, or distribute any copyrighted content. The application includes media browsing and discovery features that display publicly available metadata (titles, posters, descriptions, and ratings) sourced from third-party public APIs; Orion does not own, store, or claim rights over any of this metadata.*

*When a user initiates a stream, Orion sends a query to a user-configured external provider API. The developers have no control over what providers users configure or what content those providers return. Orion connects exclusively to endpoints specified by the end user in their own configuration.*

*Users are solely responsible for ensuring their use of Orion complies with all applicable local laws and regulations regarding copyright and media consumption.*

---

<br>

<div align="center">

**Built for the self-hosted community**

If Orion makes your media setup simpler, consider giving it a ⭐

[Report Bug](https://github.com/guyavrhm/orion/issues) · [Request Feature](https://github.com/guyavrhm/orion/issues) · [Discussions](https://github.com/guyavrhm/orion/discussions)

</div>
