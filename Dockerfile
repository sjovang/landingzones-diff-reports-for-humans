FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

USER node

EXPOSE 3000
CMD ["node", "build/index.js"]
