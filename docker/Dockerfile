# Production images for the Mindspace HR ERP. Build from the repository root:
#   docker build -f docker/Dockerfile --target api -t mindspace-hr-api .
#   docker build -f docker/Dockerfile --target web -t mindspace-hr-web \
#     --build-arg API_PROXY_TARGET=http://api:4000 --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key> .
# Or run everything with docker compose -f docker-compose.prod.yml up --build

ARG NODE_IMAGE=node:22.20.0-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci

FROM deps AS build
# Baked into the web build: where the website forwards /api calls, and the CAPTCHA site key
ARG API_PROXY_TARGET=http://api:4000
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ENV API_PROXY_TARGET=${API_PROXY_TARGET} NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build -w apps/api && NEXT_OUTPUT=standalone npm run build -w apps/web && npm prune --omit=dev

# ---------- API: NestJS + Prisma ----------
FROM ${NODE_IMAGE} AS api
WORKDIR /app
ENV NODE_ENV=production PORT=4000 STORAGE_DIR=storage
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
RUN mkdir -p /app/apps/api/storage && chown -R node:node /app/apps/api/storage
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply any pending migrations, then start
CMD ["sh", "-c", "node /app/node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]

# ---------- Web: Next.js standalone server ----------
FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
