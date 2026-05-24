---
created: 2026-05-24T08:00:00.000Z
title: Use `npm ci` and copy package-lock.json in Dockerfiles
area: infra
files:
  - api/Dockerfile:3-5
  - api/Dockerfile:10-12
  - web/Dockerfile:3-5
---

## Problem

Both Dockerfiles use `npm install` instead of `npm ci`, and the runtime stage of
`api/Dockerfile` doesn't even copy `package-lock.json`:

```dockerfile
# api/Dockerfile:3-5  (build stage)
COPY package.json ./
RUN npm install

# api/Dockerfile:10-12 (runtime stage)
COPY package.json ./
RUN npm install --omit=dev   # ← no lockfile in scope
```

```dockerfile
# web/Dockerfile:3-5
COPY package.json ./
RUN npm install
```

Three problems:

- **No lockfile pinning.** `npm install` re-resolves the dep graph; any rebuild can
  drift to newer semver-compatible versions. Reproducibility lost.
- **Build vs runtime drift.** The api's two independent installs can yield different
  versions of the same dep — what was compiled and tested in the build stage isn't
  what runs in the runtime stage. Especially nasty for native modules like `bcrypt`.
- **Slower builds.** `npm ci` is strict-mode-only but faster (no resolution pass,
  prunes node_modules first).

Neither Dockerfile sets `USER node` (both run as root) or declares a `HEALTHCHECK`
(see separate api-healthcheck TODO).

## Solution

**api/Dockerfile:**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
```

(The `HEALTHCHECK` assumes a `/api/health` endpoint — add `@Controller('health')`
returning `200 {status:'ok'}` if not present. The `wget` is built into
`node:alpine`.)

**web/Dockerfile** (similar):

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY web-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

While here:

- Add `.dockerignore` files in both folders excluding `node_modules`, `dist`,
  `.git`, `*.log`, `.env*` so build context stays small and secrets don't leak in.
- Pin the Node version in `package.json` `"engines"` block to match the Dockerfile.
