**Overview**

- Next.js client (`client/`) and PeerJS signaling server (`signaling/`).
- Two ways to run: (1) Local via Makefile (no Docker), (2) Docker Compose (optional).

**Prerequisites**

- Node.js 20+ (for Makefile/local runs)
- Docker & Docker Compose (if you choose the Docker path)

**Path 1: Makefile (local, recommended)**

- Prepare envs & install deps:
  - `make env`
  - `make install`
- Start both (signaling bg + client fg):
  - `make dev`
- Or separate terminals:
  - Terminal 1: `make dev-signaling`
  - Terminal 2: `make dev-client`
- Production build/start:
  - `make build-client`
  - `make start-client`
- Lint: `make lint`
- Clean node_modules/.next: `make clean`

**Path 2: Docker Compose (optional)**

- Start: `docker compose up -d`
- Logs: `docker compose logs -f client signaling`
- Stop: `docker compose down`

**Services**

- `signaling`: PeerJS server on port 5432.
- `client`: Next.js app on port 3000.

**Environment Configuration**

- Initialize env files: `make env` (copies `.env.example` → `.env` in `client/` & `signaling/` if missing).
- Makefile dev uses localhost signaling by default:
  - `NEXT_PUBLIC_PEER_HOST=localhost`
  - `NEXT_PUBLIC_PEER_PORT=5432`
  - `NEXT_PUBLIC_PEER_PATH=/`
  - `NEXT_PUBLIC_PEER_SECURE=false`
- Docker Compose uses in-cluster host `signaling` by default.
- Optional STUN/TURN (set in client env):
  - `NEXT_PUBLIC_STUN_URL`, `NEXT_PUBLIC_STUN_USERNAME`, `NEXT_PUBLIC_STUN_CREDENTIAL`

**Manual (no Makefile) local run**

- Signaling: `cd signaling && cp .env.example .env && npm ci && npm start`
- Client: `cd client && cp .env.example .env && npm ci && npm run dev`

**Access**

- Client UI: http://localhost:3000
- Signaling server: ws at localhost:5432 (Peer)

**Notes**

- If using Docker, node_modules are cached via named volumes for faster installs.
- Adjust STUN/TURN in `client/.env` for real-world NAT traversal.
