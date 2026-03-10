# ============================================================
# LAN Gameparty - Dockerfile
# Multi-stage build: Alpine + native module compilation
# ============================================================

# ---- Stage 1: Builder (kompiliert native Module) ----
FROM node:20-alpine AS builder

# Build-Tools fuer better-sqlite3 (native Node-Modul)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# ---- Stage 2: Runtime (schlankes finales Image) ----
FROM node:20-alpine

WORKDIR /app

# Vorkompilierte node_modules aus Builder-Stage
COPY --from=builder /app/node_modules ./node_modules

# App-Quellcode (keine DB, keine dev-Dateien)
COPY server.js ./
COPY package.json ./
COPY index.html ./
COPY js/ ./js/
COPY css/ ./css/
COPY svg/ ./svg/
COPY sounds/ ./sounds/

# Daten-Verzeichnis fuer SQLite-Datenbank
RUN mkdir -p /data

# Zeitzone
RUN apk add --no-cache tzdata

# Umgebungsvariablen
ENV PORT=3000
ENV DB_PATH=/data/gameparty.db
ENV NODE_ENV=production
ENV TZ=Europe/Berlin

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
