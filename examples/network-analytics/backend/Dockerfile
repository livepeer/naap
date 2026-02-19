FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY examples/network-analytics/backend/package*.json ./
RUN npm ci --omit=dev

COPY examples/network-analytics/backend/dist ./dist

USER appuser

EXPOSE 4015

CMD ["node", "dist/server.js"]
