# One-off SEEDER image for the seed-ds1 workflow (RQ-0004 follow-up; ADR-0007 named a workflow_dispatch
# seed path now that the data is the system of record). The production service image is dist-only and
# cannot run the seeder (no tsx/scripts/config), so this image carries the source + dev deps + the seed
# YAML and runs `npm run seed` against the live Mongo on the compose network.
#
# Build context is the REPO ROOT (it needs both service/ and config/); the root .dockerignore keeps the
# context small. Run it with SEED_FILE=/config/<file>, MONGO_URI, MONGO_DB_NAME and the ${SEED_*} secrets.
FROM node:current-alpine
WORKDIR /app

# Install deps first for layer caching. vendor/ holds the maestro SDK tarball (file: dependency).
COPY service/package*.json ./
COPY service/vendor/ ./vendor/
RUN npm install

# Source (scripts/, src/) + the seed definitions (copied to /config so SEED_FILE=/config/<file> resolves).
COPY service/ ./
COPY config/ /config/

CMD ["npm", "run", "seed"]
