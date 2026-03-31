FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --production=false

# Copy root tsconfig (backend extends it) and backend tsconfig
COPY tsconfig.docker.json ./tsconfig.json
COPY src/ ./src/
COPY prisma/ ./prisma/

RUN npx prisma generate
RUN npx tsc --project tsconfig.json

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "dist/server.js"]
