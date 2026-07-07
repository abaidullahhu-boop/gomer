# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

# Install all deps (incl. dev) for the Nest build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only production dependencies (typeorm CLI + pg ship here for migrations).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled application.
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Overridden by the pre-deploy migration job; default is to serve the API.
CMD ["node", "dist/main"]
