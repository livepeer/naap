FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S bridge && adduser -S bridge -G bridge
COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist/ ./dist/
USER bridge
EXPOSE 4116
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:4116/healthz || exit 1
CMD ["node", "dist/server.js"]
