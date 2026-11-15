FROM node:20-alpine

WORKDIR /app

# Copy server package definitions
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server and client application files
COPY server ./server
COPY client ./client

WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
