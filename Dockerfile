FROM node:20-bullseye

WORKDIR /usr/src/app

# Copy package files first so npm layer can be cached
COPY package*.json ./

# Ensure the place where browsers will be installed and export path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install OS deps required by Playwright
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libasound2 \
    libxshmfence1 libgbm1 libxrandr2 libxcomposite1 libxdamage1 libxfixes3 \
    fonts-liberation libpangocairo-1.0-0 libxss1 wget gnupg --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Node deps (playwright package etc)
RUN npm install --production

# Create and set permissions for the browsers path, then install browser binaries there
RUN mkdir -p /ms-playwright && chown -R root:root /ms-playwright
RUN npx playwright install --with-deps

# Copy application source (web11.js + start.sh)
COPY . .

# Ensure start script is executable
RUN chmod +x ./start.sh

EXPOSE 3000

# Start your unchanged script via wrapper
CMD ["./start.sh"]
