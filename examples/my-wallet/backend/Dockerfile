FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY examples/my-wallet/backend/package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

COPY examples/my-wallet/backend/dist ./dist

USER appuser

EXPOSE 4012

CMD ["node", "dist/server.js"]
