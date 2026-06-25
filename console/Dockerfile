# Next.js standalone build for the identity-service admin console (ADR-0007).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined into the CLIENT bundle at BUILD time (not read at runtime), so they must be
# passed as build args — otherwise lib/auth falls back to its localhost defaults and the browser login
# posts to the wrong host. Provided by docker/compose.yaml `build.args`.
ARG NEXT_PUBLIC_IDENTITY_SERVICE_BASE
ARG NEXT_PUBLIC_IDENTITY_SERVICE_CLIENT_ID
ENV NEXT_PUBLIC_IDENTITY_SERVICE_BASE=${NEXT_PUBLIC_IDENTITY_SERVICE_BASE}
ENV NEXT_PUBLIC_IDENTITY_SERVICE_CLIENT_ID=${NEXT_PUBLIC_IDENTITY_SERVICE_CLIENT_ID}
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `output: 'standalone'` emits a self-contained server bundle + the minimal node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 7306
CMD ["node", "server.js"]
