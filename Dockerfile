FROM node:20-bookworm-slim

# Create app directory
WORKDIR /app

# Install system dependencies for Chromium + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    libgbm1 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Use system Chromium instead of downloading a browser at install time
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=8000

# Install app dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Bundle app source
COPY . .

EXPOSE 8000
CMD ["node", "src/server.js"]

