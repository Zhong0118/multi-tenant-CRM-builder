# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS tooling
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

FROM tooling AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# Next.js embeds NEXT_PUBLIC_* at build time; never pass provider keys here.
ARG NEXT_PUBLIC_API_ORIGIN
RUN test -n "$NEXT_PUBLIC_API_ORIGIN"
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN
# Prisma config requires a URL while generating; this dummy URL is never contacted.
RUN DATABASE_ADMIN_URL=postgresql://build:build@localhost:5432/build pnpm build

FROM tooling AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV COREPACK_ENABLE_NETWORK=0
COPY --from=build /app /app
EXPOSE 3001
CMD ["pnpm", "--filter", "@crm/api", "start:prod"]
