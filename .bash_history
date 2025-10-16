ls
cat web11.js
echo -e '#!/usr/bin/env bash\nexport PLAYWRIGHT_BROWSERS_PATH=/ms-playwright\nnode web11.js' > start.sh && chmod +x start.sh
cat > Dockerfile <<'EOF'
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
EOF

ls
find . -maxdepth 1 ! -name 'web11.js' ! -name 'start.sh' ! -name 'Dockerfile' ! -name '.' -exec rm -rf {} +
ls
git init && git add . && git commit -m "Initial commit for Render deploy"
git remote add origin https://github.com/<your-username>/<repo-name>.git
git remote add origin https://github.com/hrachyazakharyan6/web11.git
git branch -M main && git push -u origin main
git remote add origin https://github.com/hrachyazakharyan6/web11.git
git branch -M main
git push -u origin main
pkg install gh -y
gh auth login
exit
