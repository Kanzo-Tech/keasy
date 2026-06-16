FROM node:22-alpine AS builder

# pnpm (pnpm-lock.yaml is v9). @fossil-lang/* come from npm (the `alpha` dist-tag)
# — no vendoring.
RUN npm install -g pnpm@9

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
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
