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
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY README.md LICENSE .env.example ./

ENTRYPOINT ["node", "dist/index.js", "start"]
