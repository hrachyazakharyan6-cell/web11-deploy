FROM node:20-bullseye
WORKDIR /usr/src/app
# copy package files first for Docker cache (if they exist)
COPY package.json package-lock.json* ./
# copy app sources
COPY web11.js ./
COPY start.sh ./
# install OS deps required for Playwright
RUN apt-get update && \
    apt-get install -y wget ca-certificates libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxrandr2 libasound2 libgbm1 libxss1 libxshmfence1 libdrm2 fonts-liberation libxkbcommon0 --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
# install node deps (playwright + runtime libs) and browsers
RUN npm install playwright express socket.io node-fetch --production || true && \
    npx playwright install --with-deps chromium || true
EXPOSE 3000
CMD ["bash", "./start.sh"]
