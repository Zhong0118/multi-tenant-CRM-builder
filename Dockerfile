# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# Next.js embeds NEXT_PUBLIC_* at build time; never pass provider keys here.
ARG NEXT_PUBLIC_API_ORIGIN
RUN test -n "$NEXT_PUBLIC_API_ORIGIN"
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN
# Prisma config requires a URL while generating; this dummy URL is never contacted.
RUN DATABASE_ADMIN_URL=postgresql://build:build@localhost:5432/build pnpm build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app /app
EXPOSE 3001
CMD ["pnpm", "--filter", "@crm/api", "start:prod"]
