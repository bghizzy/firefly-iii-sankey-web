# Firefly III Sankey Web UI

WARNING: Completely vibe coded in Gemini for personal use, I do not intend to publish further.

A lightweight Express web interface wrapper for [barreeeiroo's firefly-iii-sankey](https://github.com/barreeeiroo/Firefly-III-Sankey/tree/main) designed to run in Docker / Unraid.

## Features
- Serves a simple web interface to generate SankeyMatic text from Firefly III data.
- Accepts Firefly III URL and Personal Access Token via environment variables or Web UI.

## Environment Variables
| Variable | Description |
|---|---|
| `FIREFLY_URL` | Base URL of your Firefly III instance |
| `FIREFLY_TOKEN` | Personal Access Token |
| `PORT` | Container internal port (default: `3000`) |

## Quick Start (Docker Compose)
```yaml
services:
  firefly-sankey-web:
    build: https://github.com/your-username/firefly-sankey-web.git#main
    container_name: firefly-sankey-web
    ports:
      - "8088:3000"
    environment:
      - FIREFLY_URL=https://firefly.yourdomain.com
      - FIREFLY_TOKEN=your_personal_access_token_here
      - PORT=3000
    restart: unless-stopped
```
