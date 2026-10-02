# ── Build ────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
COPY test ./test
COPY web ./web
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

# ── Run ──────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
# Set DATABASE_URL (Postgres) on the host. Without it the app falls back to a
# SQLite file in DATA_DIR, which only survives restarts on a persistent disk.
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TRUST_PROXY=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/main.js"]
