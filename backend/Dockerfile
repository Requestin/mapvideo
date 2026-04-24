FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation fonts-dejavu fonts-noto-color-emoji \
    libnss3 libfreetype6 libharfbuzz0b \
    ffmpeg \
    dumb-init wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
