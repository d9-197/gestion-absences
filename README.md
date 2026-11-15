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
| `api/migrations/` | Migrations SQL du schéma, appliquées par le conteneur `migrations` |
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

Les tests du schéma ont besoin d'une base PostgreSQL et sont ignorés sans elle. Avec la pile de développement démarrée :

```bash
TEST_DB_HOST=localhost TEST_DB_PASSWORD=<mot de passe de absences_owner> npm test
```

Chaque exécution crée une base jetable, y applique les migrations, puis la supprime.

## Schéma de base de données

Le schéma est décrit par les migrations de `api/migrations/`. Le conteneur `migrations` les applique avec le compte propriétaire avant chaque démarrage de l'API. Pour en ajouter une, créer le fichier suivant dans la numérotation (`0002_....sql`), sans modifier une migration déjà appliquée.

| Table | Contenu |
| --- | --- |
| `equipes` | Équipes arborescentes, avec leur responsable |
| `collaborateurs` | Collaborateurs, leur équipe et leur rôle |
| `delegations` | Délégués habilités à valider pour une équipe |
| `types_absence` | Types administrables : approbation, confidentialité, délai de prévenance |
| `jours_feries`, `jours_imposes` | Calendrier : jours fériés et jours non travaillés imposés |
| `parametres` | Réglages : durée de conservation, mentions du PDF |
| `demandes` | Demandes d'absence et d'annulation, figées à l'insertion |
| `evenements_demande` | Journal : soumission, approbation, refus, retrait, annulation |
| `envois_email` | Suivi des e-mails, pour relancer les échecs |

Le statut d'une demande n'est pas stocké : la vue `demandes_avec_statut` le déduit du dernier événement du journal.

Règles garanties par la base elle-même, et non par le code de l'API :

- `demandes` et `evenements_demande` sont en ajout seul. Le compte applicatif n'a que les droits de lecture et d'insertion, et des déclencheurs refusent toute modification ou suppression, même au compte propriétaire.
- Les enchaînements d'événements sont contrôlés : une demande déjà décidée ne peut plus l'être, et deux décisions simultanées ne passent pas toutes les deux.
- Un refus exige un motif. Les horodatages sont imposés par le serveur.
- L'approbation d'une demande d'annulation fait passer la demande d'origine à « annulée ».
- La seule suppression possible est la fonction `purger_demandes`, pour la durée de conservation.

## Comptes de base de données

- `absences_owner` : propriétaire du schéma, réservé aux migrations.
- `absences_app` : compte utilisé par l'API. Il ne possède aucun objet ; ses droits lui viennent du groupe `absences_api`, auquel les migrations accordent les droits table par table.

Le script `db/init/01-roles.sh` ne s'exécute qu'à la création du volume `db-data`. Changer un mot de passe dans `.env` après coup ne modifie pas la base.

## État

La structure Docker et le schéma de base de données sont en place. L'API et l'interface ne font encore que vérifier la liaison entre les conteneurs : aucune fonctionnalité métier n'est développée.
