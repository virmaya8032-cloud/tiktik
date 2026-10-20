# TikTik production image. Node 24 includes the built-in node:sqlite driver the server uses.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
COPY scripts/set-password.js ./scripts/set-password.js
# Database and uploaded videos live in /app/data (mounted from the host so they survive updates).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
