FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY examples/daydream-video/backend/package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

COPY examples/daydream-video/backend/dist ./dist

USER appuser

EXPOSE 4211

CMD ["node", "dist/server.js"]
