FROM node:20-alpine AS build
WORKDIR /app
# Copy the lockfile so `npm ci` can install the exact resolved tree, not
# whatever `npm install` would resolve fresh each build.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Drop root: alpine images already ship a `node` user.
USER node
EXPOSE 3000
# Probes /api/health (registered by HealthModule). `wget` is in node:alpine
# already, so no extra packages needed.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
