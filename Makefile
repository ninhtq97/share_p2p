# Makefile for running the project locally (no Docker)

.PHONY: help env install dev-signaling dev-client dev build-client start-client lint clean

help:
	@echo "Targets:"
	@echo "  env              - Copy .env.example to .env if missing"
	@echo "  install          - npm ci in client/ and signaling/"
	@echo "  dev-signaling    - Start PeerJS signaling server on :5432"
	@echo "  dev-client       - Start Next.js dev server on :3000 (connects to localhost:5432)"
	@echo "  dev              - Start signaling (bg) then client"
	@echo "  build-client     - Build Next.js app"
	@echo "  start-client     - Start Next.js (production) on :3000"
	@echo "  lint             - Run lints in client/"
	@echo "  clean            - Remove build artifacts and node_modules"

env:
	@test -f client/.env || cp client/.env.example client/.env
	@test -f signaling/.env || cp signaling/.env.example signaling/.env
	@echo "Ensured .env files exist in client/ and signaling/"

install:
	cd signaling && npm ci
	cd client && npm ci

dev-signaling:
	cd signaling && npm start

dev-client:
	cd client && npm run dev

# Start signaling in background, then client in foreground
dev:
	(cd signaling && npm start &) && sleep 1 && \
	cd client && npm run dev

build-client:
	cd client && npm run build

start-client:
	cd client && npm start

lint:
	cd client && npm run lint || true

clean:
	rm -rf client/.next client/node_modules signaling/node_modules
