# TikTik production image. Node 24 includes the built-in node:sqlite driver the server uses.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
COPY scripts/set-password.js scripts/set-admin.js scripts/backup.js ./scripts/
# Database and uploaded videos live in /app/data (mounted from the host so they survive updates).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
# Docker marks the container unhealthy if the app or its database stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
