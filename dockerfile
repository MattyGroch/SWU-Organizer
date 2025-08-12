# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
LABEL org.opencontainers.image.title="SWU Organizer" \
      org.opencontainers.image.description="Organize Star Wars: Unlimited binders; search, visualize, and track inventory." \
      org.opencontainers.image.source="https://github.com/MattyGroch/SWU-Organizer" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"
CMD ["nginx", "-g", "daemon off;"]
HEALTHCHECK CMD wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1
