# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Drop devDependencies here (build tools are still present, so native rebuilds
# succeed). The runtime image reuses the resulting node_modules verbatim.
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache wget
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/schema.sql ./dist/schema.sql

EXPOSE 3001
HEALTHCHECK CMD wget -qO- http://localhost:3001/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/index.js"]
