FROM node:22-alpine AS builder

WORKDIR /app
# Vendored @fossil-lang/* packages are `file:./vendor/...tgz` deps — copy them
# before `npm ci` (else ENOENT on the tarballs).
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app
RUN addgroup -S keasy && adduser -S keasy -G keasy
USER keasy

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
