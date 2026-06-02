FROM node:22-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source
COPY . .

# Snapshot dir (mount a volume here in Dokploy: /app/state)
RUN mkdir -p /app/state

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
