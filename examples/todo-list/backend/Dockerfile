FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY examples/todo-list/backend/package*.json ./
RUN npm ci --omit=dev

COPY examples/todo-list/backend/dist ./dist

USER appuser

EXPOSE 4021

CMD ["node", "dist/server.js"]
