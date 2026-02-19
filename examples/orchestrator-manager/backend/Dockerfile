FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY examples/orchestrator-manager/backend/package*.json ./
COPY packages /packages
RUN npm ci --omit=dev

COPY examples/orchestrator-manager/backend/dist ./dist

USER appuser

EXPOSE 4002

CMD ["node", "dist/server.js"]
