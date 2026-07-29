# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache wget
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/schema.sql ./dist/schema.sql

EXPOSE 3001
HEALTHCHECK CMD wget -qO- http://localhost:3001/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/index.js"]
