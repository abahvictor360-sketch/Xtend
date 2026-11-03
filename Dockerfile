# Xtend as one container, for Dokploy or Coolify (deploy/DOCKER.md).
#
# The NEXT_PUBLIC_* values are baked into the pages at build time, so they
# are build arguments: set them in the platform's build settings as well as
# its environment. Everything secret is runtime environment only and never
# enters the image.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
ARG NEXT_PUBLIC_REALTIME_DISABLED
# Cloudflare Turnstile on the sign-in form (optional; TURNSTILE_SECRET_KEY
# is runtime only). The check is on only when both keys are set.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
# Coolify passes the commit as SOURCE_COMMIT; the update banner uses it.
ARG SOURCE_COMMIT
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    XTEND_BUILD_ID=${SOURCE_COMMIT}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    || { echo "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY as build arguments." >&2; exit 1; }
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TRUSTED_PROXY_HOPS=1
# The built server only, owned by the unprivileged node user.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Scheduled jobs: `node run-job.mjs alerts` and so on (deploy/DOCKER.md).
COPY --from=build --chown=node:node /app/docker/run-job.mjs ./run-job.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
