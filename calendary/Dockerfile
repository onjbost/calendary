# Calendary — Home Assistant add-on (also runs as a plain Docker container)

# ---- 1. build the web app ------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
# the lock file is generated on Windows: fall back to install if platform binaries differ
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. runtime ------------------------------------------------------------
FROM node:24-alpine
RUN apk add --no-cache tzdata
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=web /app/web/dist /app/web/dist

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787
EXPOSE 8787

LABEL io.hass.type="addon" \
      io.hass.name="Calendary" \
      io.hass.description="Calendario, promemoria e pianificazione in stile neon"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
