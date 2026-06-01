FROM node:20-alpine AS builder
WORKDIR /app
# Prisma's musl query engine links against OpenSSL; install it so `prisma
# generate` detects OpenSSL 3 and the engine can load.
RUN apk add --no-cache openssl
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
# pnpm is optional — fall back to npm if lockfile missing.
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else npm install; fi
COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Runtime needs libssl.so.3 for Prisma's linux-musl-openssl-3.0.x engine.
RUN apk add --no-cache openssl
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
EXPOSE 3000
# ECS injects discrete DB_* secrets; assemble DATABASE_URL (same encoding as
# src/main.ts), apply Prisma migrations, then start. `migrate deploy` is
# idempotent and takes an advisory lock, so it's safe across multiple tasks.
CMD ["sh", "-c", "export DATABASE_URL=$(node -e \"const e=encodeURIComponent,p=process.env;process.stdout.write('postgresql://'+e(p.DB_USER)+':'+e(p.DB_PASSWORD)+'@'+p.DB_HOST+':'+(p.DB_PORT||'5432')+'/'+p.DB_NAME+'?schema=app')\") && npx prisma migrate deploy && node dist/main.js"]
