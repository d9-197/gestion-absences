FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Développement : toutes les dépendances, rechargement à chaud (src monté en volume).
FROM base AS dev
RUN npm ci
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "--watch", "src/server.js"]

# Production : dépendances d'exécution seulement, utilisateur non privilégié.
FROM base AS prod
ENV NODE_ENV=production
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
