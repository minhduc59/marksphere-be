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
CMD ["node", "dist/main.js"]
