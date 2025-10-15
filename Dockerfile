FROM node:20-bullseye

WORKDIR /usr/src/app

# Copy only package files first so Docker layer caching works
COPY package*.json ./

# Install system deps required by Playwright
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libasound2 \
    libxshmfence1 libgbm1 libxrandr2 libxcomposite1 libxdamage1 libxfixes3 \
    fonts-liberation libpangocairo-1.0-0 libxss1 wget gnupg --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Node dependencies (including playwright package)
RUN npm install --production

# Copy app sources
COPY . .

# Install Playwright browser binaries (with OS deps)
RUN npx playwright install --with-deps

# Make start script executable
RUN chmod +x ./start.sh

EXPOSE 3000

CMD ["./start.sh"]
