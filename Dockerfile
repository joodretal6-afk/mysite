# صورة تشغيل المنصة (بديل مضمون لو Nixpacks ما ضبط better-sqlite3)
FROM node:22-slim

# أدوات بناء better-sqlite3 (native)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# مجلد قاعدة البيانات (يُربط بـ Volume دائم)
ENV DB_PATH=/data/platform.db
RUN mkdir -p /data

EXPOSE 3000
CMD ["npm", "start"]
