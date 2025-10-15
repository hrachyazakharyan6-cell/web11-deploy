FROM node:20-bullseye

WORKDIR /usr/src/app
COPY . .

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libasound2 \
    libxshmfence1 libgbm1 libxrandr2 libxcomposite1 libxdamage1 libxfixes3 \
    fonts-liberation libpangocairo-1.0-0 libxss1 --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Node dependencies
RUN npm install

# Install Playwright browsers
RUN npx playwright install --with-deps

# Make start.sh executable
RUN chmod +x ./start.sh

# Expose port for web view
EXPOSE 3000

# Run your script
CMD ["./start.sh"]
