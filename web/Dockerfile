FROM node:22-alpine AS builder

# The project uses pnpm (pnpm-lock.yaml v9 + pnpm-only `file:` overrides for the
# vendored @fossil-lang/* packages — npm ci 404s on @fossil-lang/introspect).
RUN npm install -g pnpm@9

WORKDIR /app
# Vendored @fossil-lang/* packages are `file:./vendor/...tgz` deps — present
# before install (else ENOENT / registry 404 on the tarballs).
COPY package.json pnpm-lock.yaml ./
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

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
