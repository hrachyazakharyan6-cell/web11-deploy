FROM node:20-bullseye

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production

COPY . .
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libasound2 \
    libxshmfence1 libgbm1 libxrandr2 libxcomposite1 libxdamage1 libxfixes3 \
    fonts-liberation libpangocairo-1.0-0 libxss1 --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

RUN npx playwright install --with-deps

EXPOSE 3000
CMD ["./start.sh"]
