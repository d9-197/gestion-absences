FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Développement : serveur Vite avec rechargement à chaud (src monté en volume).
FROM deps AS dev
COPY index.html vite.config.js ./
COPY src ./src
# Vite écrit un fichier temporaire à côté de sa configuration et un cache dans node_modules/.vite.
RUN mkdir -p node_modules/.vite && chown node:node /app node_modules/.vite
USER node
EXPOSE 5173
CMD ["npx", "vite"]

FROM deps AS build
# Chemin public si l'application est publiée sous un préfixe derrière un proxy (ex. /abs) ; vide à la racine.
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# Production : fichiers statiques servis par nginx, utilisateur non privilégié.
FROM nginxinc/nginx-unprivileged:alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
