# Stage 1: build (нужны devDependencies: vite, esbuild, tsx, typescript)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: только production-зависимости. drizzle-kit лежит в dependencies:
# entrypoint применяет им миграции при каждом старте.
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Stage 3: production
FROM node:20-alpine AS runner

RUN apk add --no-cache ffmpeg

WORKDIR /app

# Файлы принадлежат root и доступны процессу только на чтение. Писать
# приложению нужно лишь во временный каталог (голосовые режет ffmpeg в
# os.tmpdir() = /tmp), PDF и XLSX собираются в памяти.
COPY --from=deps /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy drizzle config, shared schema and versioned migrations for `drizzle-kit migrate`
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/migrations ./migrations
# Подписанные шорткаты iOS — их отдаёт команда /quick (собрать в контейнере
# нельзя: подпись ставит только macOS).
COPY --from=builder /app/shortcuts ./shortcuts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json

# Copy migration entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 5000

# Процесс и миграции — от непривилегированного пользователя из базового
# образа (uid 1000, HOME=/home/node — туда npx пишет свой кэш).
USER node

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.cjs"]
