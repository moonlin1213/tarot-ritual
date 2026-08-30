# ARCANUM · Tarot Ritual

[简体中文](README.md) | **English**

A local 3D tarot application with a starlit stage, procedural particle card art, animated shuffling and reveals, and optional streaming AI readings.

Runs on **Windows, macOS, and Linux**. No frontend build step and no credentials in source code. The current application interface and built-in interpretations are in Simplified Chinese; this English README documents the same application.

## Features

- All 78 Rider–Waite–Smith cards with built-in upright/reversed interpretations and symbolic descriptions.
- Five spreads: One Card, Three Card, Five Card Relationship, Seven Card Horseshoe, and Celtic Cross.
- Spread recommendations based on Chinese question keywords, with manual selection available.
- Three.js shuffling, fan selection, flying cards, reveals, drag-to-pan navigation, and card details.
- Three AI protocols: OpenAI-compatible Chat Completions, Responses, and Anthropic Messages.
- Physical card recognition: locally resize a photo, send it to your chosen vision model, then correct the card or orientation manually if needed.
- Optional, read-only DSH configuration import, disabled by default. No account configuration is included.

Tarot and AI output are for entertainment and reflection. They are not factual predictions or a substitute for medical, legal, or financial advice. Interpretations and astrological correspondences vary between traditions; this project uses one set of conventions.

## Quick start

Install **Node.js 24 LTS, version 24.5 or newer**, and Git. Use a browser with WebGL 2 support, such as a recent Edge, Chrome, Firefox, or Safari.

Run these commands in PowerShell, CMD, Terminal, or your preferred shell:

```sh
git clone https://github.com/moonlin1213/tarot-ritual.git
cd tarot-ritual
npm ci --ignore-scripts
npm start
```

Open **http://127.0.0.1:8642**. Press `Ctrl+C` or close the terminal to stop the service. You can also download the repository as a ZIP, extract it, and run the final two commands inside the project directory.

You can draw cards and inspect their built-in meanings without connecting an AI service. For AI readings, open the provider control at the top right, enter your own provider name, protocol, Base URL, and API key, then choose a model. If the provider does not offer model discovery, enter a model ID manually in its settings.

Custom providers and keys live only in the current page's memory. Reloading or closing the page requires entering them again.

### Windows notes

- Startup and test commands work in CMD and PowerShell without Bash, WSL, `export`, or Unix environment-variable prefixes.
- If PowerShell blocks `npm.ps1`, use `npm.cmd ci --ignore-scripts` and `npm.cmd start`. You do not need to change your system execution policy.
- Project paths may contain spaces or Chinese characters. Static files are resolved relative to the server script.
- Use the `127.0.0.1` address. The server does not listen on the LAN and does not need an Internet-facing firewall rule.

## AI configuration

| Protocol | Example Base URL | Appended paths |
| --- | --- | --- |
| OpenAI-compatible | `https://api.example.com/v1` | `/chat/completions`, `/models` |
| Responses | `https://api.example.com/v1` | `/responses`, `/models` |
| Anthropic | `https://api.anthropic.com`, or a compatible URL ending in `/v1` | `/v1/messages`, `/v1/models`; `/v1` is not duplicated |

Remote URLs must use HTTPS. Loopback gateways may use HTTP, such as `http://127.0.0.1:PORT`. Never embed credentials, usernames, passwords, or query parameters in the Base URL. Upstream redirects are not followed; enter the final endpoint directly. Available models, fees, terms, and API behavior depend on the provider.

Choose a model that supports the selected protocol. Photo recognition additionally requires vision support; appearing in a model list does not guarantee that capability.

### Optional DSH import

Only if you want to reuse your DSH configuration, run:

```sh
npm run start:dsh
```

The default directory is based on the operating system's home directory: typically `%USERPROFILE%\.dsh` on Windows or `~/.dsh` on macOS/Linux. The server reads `settings.yaml`, `.credentials.yaml`, and `.everything-oauth.json` without writing them back. It returns provider/model metadata to the browser, never API keys, access tokens, or refresh tokens.

When an OAuth access token expires, refresh it or sign in again through DSH and retry. This application does not refresh tokens, rotate refresh tokens, or implement an OAuth login flow. Some OAuth services do not offer model discovery; enter a supported model ID manually. DSH file formats are an external compatibility surface and may require future adapter updates.

To change the port or DSH directory:

PowerShell:

```powershell
$env:PORT = "8643"
$env:TAROT_DSH_DIR = Join-Path $env:USERPROFILE ".dsh"
npm run start:dsh
```

CMD:

```bat
set "PORT=8643"
set "TAROT_DSH_DIR=%USERPROFILE%\.dsh"
npm run start:dsh
```

macOS/Linux:

```sh
PORT=8643 TAROT_DSH_DIR="$HOME/.dsh" npm run start:dsh
```

You may also enable import with `TAROT_DSH_IMPORT=1`. A normal `npm start` does not read DSH unless you have already set that variable in your environment. The project does not automatically load `.env` files.

### Proxies

The startup command uses Node.js `--use-env-proxy` to honor existing `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` settings. No personal proxy address is hardcoded. When using a local AI gateway, add `127.0.0.1,localhost,::1` to `NO_PROXY` so local traffic does not pass through an external proxy. See the [Node.js proxy documentation](https://nodejs.org/api/cli.html#--use-env-proxy).

## Privacy boundaries

- The page, fonts, and Three.js load locally. There are no analytics, telemetry, or remote CDN dependencies.
- Drawing cards and reading built-in meanings do not require AI. Starting an AI reading sends **your question, spread, selected cards, and prompts to your chosen provider**.
- Selecting a photo immediately starts recognition with the chosen vision model. The page resizes the image and re-encodes it as JPEG using Canvas. Check the visible contents for faces, documents, or anything else you do not want to share.
- API keys or OAuth access tokens are sent as authentication to that provider. Local execution does not mean all data stays offline; upstream retention depends on the provider's policies.
- Custom providers and keys remain in page memory. On startup, the app removes custom keys saved by older versions in localStorage. Only the selected provider ID and model preferences persist in browser storage.
- The server does not save questions, photos, readings, or request logs. Copying a reading writes to the system clipboard. Browser extensions, other local processes, and the operating system remain part of your trust boundary.
- The server binds only to `127.0.0.1`, validates Host/Origin/request markers, and blocks cross-site requests and static path escapes.

**Do not deploy this credential proxy as a public service or expose it through tunnels or reverse proxies.** This repository provides source code for a local application, not a hosted product with multi-user authentication.

## Development and verification

```sh
npm run check
npm test
npm audit --omit=dev
```

Tests use temporary directories, fake credentials, and local mock upstream servers. They do not read real DSH configuration or invoke paid models. GitHub Actions checks Node.js 24 and 26 on Windows, macOS, and Linux. Coverage includes static-file isolation, request origins, credential storage, model discovery, streaming protocols, duplicate reading requests, and startup from Unicode paths.

## Project layout

```text
server.mjs           Local HTTP service, read-only DSH import, streaming proxy
public/index.html    Page structure
public/css/          Visual styles
public/data/         Card and spread data, single source of truth
public/js/core.js    Shared module exports
public/js/ai.js      Provider state and streaming client
public/js/reading.js Prompts and escaped text rendering
public/js/main.js    Interaction and physical-card workflow
public/js/art/       Canvas particle card art
public/js/three/     3D stage and card animation
public/fonts/       Local fonts and OFL licenses
public/vendor/      Three.js and MIT license
scripts/            Portable startup and syntax checks
test/               Isolated regression tests
```

## License

Project code retains its original [ISC license](LICENSE). Three.js uses MIT; Cinzel and Cormorant Garamond use SIL OFL 1.1. See [third-party notices](THIRD_PARTY_NOTICES.md). Procedural card art is an abstract interpretation of traditional symbolism, not scanned artwork from a commercial deck.
