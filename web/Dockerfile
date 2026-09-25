FROM node:22-alpine AS builder

# pnpm (pnpm-lock.yaml is v9). @fossil-lang/* come from npm (the `alpha` dist-tag)
# — no vendoring. Build context: the repo root, since the web depends on the
# workspace package `api/` (@keasy/api).
RUN npm install -g pnpm@9

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile
COPY api ./api
COPY web ./web
RUN pnpm --filter web run build

FROM node:22-alpine

WORKDIR /app
RUN addgroup -S keasy && adduser -S keasy -G keasy
USER keasy

# The standalone output is traced from the workspace root, so the server lives
# at `web/server.js` inside it.
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "web/server.js"]
