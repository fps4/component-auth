FROM node:current-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --production

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.env.example ./ 2>/dev/null || true
EXPOSE 7305
CMD ["node", "dist/server.js"]
