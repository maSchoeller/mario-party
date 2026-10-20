# Server image for Azure Container Apps (lobby, signaling, WS relay, save API).
# The web client is served by Azure Static Web Apps in production; the image can also
# serve the built client itself (handy for a single-container test deployment).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build -w @wb/web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/server apps/server
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts --omit=dev -w @wb/server -w @wb/shared && npm install --no-save tsx@4
EXPOSE 8080
CMD ["npx", "tsx", "apps/server/src/main.ts"]
