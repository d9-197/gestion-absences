# Gestion des absences

Application interne de gestion des demandes d'absences des collaborateurs : congés, RTT, maladie, sans solde, etc.

La phase 1 trace les demandes et leurs approbations de façon inaltérable. Les compteurs de congés viendront en phase 2.

## Documentation

- [Cahier des charges](docs/cahier-des-charges.md)

## Structure

| Dossier ou fichier | Rôle |
| --- | --- |
| `compose.yaml` | Pile de base, proche de la production : `db`, `api`, `web` |
| `compose.dev.yaml` | Surcharge de développement : rechargement à chaud, ports locaux, Mailpit |
| `api/` | API REST (Node.js, Fastify) |
| `web/` | Interface (React, Vite), servie par nginx en production |
| `db/init/` | Création du compte applicatif à la première initialisation de la base |
| `docs/` | Cahier des charges |

## Démarrage

Copier le fichier d'exemple et remplacer les mots de passe :

```bash
cp .env.example .env
```

Développement, avec rechargement à chaud :

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

- Interface : http://localhost:8080
- API : http://localhost:3000/api/health
- E-mails capturés par Mailpit : http://localhost:8025
- PostgreSQL : `localhost:5432`

Mode proche de la production :

```bash
docker compose up --build -d
```

Seul le conteneur `web` publie un port (8080 par défaut, réglable par `WEB_PORT`). Le HTTPS est à terminer sur le reverse proxy de l'infrastructure.

Tests de l'API :

```bash
cd api && npm ci && npm test
```

## Comptes de base de données

- `absences_owner` : propriétaire du schéma, réservé aux migrations.
- `absences_app` : compte utilisé par l'API. Il ne possède aucun objet ; ses droits seront accordés table par table par les migrations, ce qui permettra de lui interdire la modification du journal.

Le script `db/init/01-roles.sh` ne s'exécute qu'à la création du volume `db-data`. Changer un mot de passe dans `.env` après coup ne modifie pas la base.

## État

La structure Docker est en place, avec une API et une interface minimales qui vérifient la liaison entre les trois conteneurs. Aucune fonctionnalité métier n'est encore développée.
