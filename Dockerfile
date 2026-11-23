FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
# Deliberately requires a reviewed package-lock.json before image builds.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
USER node
EXPOSE 3001
CMD ["node", "dist/src/server.js"]
