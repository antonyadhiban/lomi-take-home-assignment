# One Dockerfile for every Node service; pick with --build-arg APP=api|worker|web.
# turbo prune keeps each image's install/build to the packages that app needs.
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /repo

FROM base AS pruner
ARG APP
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @lomi/${APP} @lomi/db --docker

FROM base AS builder
ARG APP
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@lomi/${APP}... --filter=@lomi/db

FROM base AS runner
ARG APP
ENV NODE_ENV=production APP=${APP}
COPY --from=builder /repo .
# fixtures are outside every workspace package, so turbo prune drops them; the seed needs them
COPY --from=pruner /repo/fixtures ./fixtures
WORKDIR /repo/apps/${APP}
# RUN_MIGRATIONS=true (set on the API in production) applies migrations and the
# idempotent fixture seed before starting; compose uses a separate migrate service.
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = true ]; then (cd /repo/packages/db && pnpm migrate:deploy) && (cd /repo/apps/api && node dist/seed.js) || exit 1; fi; exec pnpm start"]
