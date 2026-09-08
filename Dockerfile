# syntax=docker/dockerfile:1

# Node 22 is the floor for a reason that matters most here: better-sqlite3
# publishes no prebuilt binary below ABI 127, so a Node 20 image had to install
# python3, make and g++ and compile it -- in both stages, then purge the
# toolchain again. On 22 the prebuilt linux-x64 binary is used and none of that
# is needed, which is why this file no longer touches apt at all.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim

# image.source is what attaches the package to this repository on GHCR --
# without it the container page is orphaned and carries no README.
#
# io.modelcontextprotocol.server.name is not decoration: the MCP Registry
# verifies ownership of an OCI package by reading this exact label, the way it
# reads mcpName out of package.json for npm. Change one and server.json has to
# change with it, or publishing is rejected.
LABEL org.opencontainers.image.source="https://github.com/Zsadigzade/trainbud" \
      org.opencontainers.image.description="Talk to your own fitness data through Claude and other MCP clients" \
      org.opencontainers.image.licenses="MIT" \
      io.modelcontextprotocol.server.name="io.github.Zsadigzade/trainbud"

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY README.md LICENSE .env.example ./

ENTRYPOINT ["node", "dist/index.js", "start"]
