FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY examples/gateway-manager/backend/package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

COPY examples/gateway-manager/backend/dist ./dist

USER appuser

EXPOSE 4101

CMD ["node", "dist/server.js"]
