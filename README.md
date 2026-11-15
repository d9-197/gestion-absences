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
| `annees_calendrier` | Années dont les jours fériés légaux ont déjà été préremplis |
| `parametres` | Réglages : durée de conservation, mentions du PDF |
| `sessions`, `jetons_mot_de_passe` | Sessions ouvertes et liens de mot de passe (empreintes seulement) |
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

## Authentification

Deux modes de connexion, selon le collaborateur :

- **Mot de passe propre à l'outil** : 12 caractères au minimum, stocké haché (scrypt). Le collaborateur le choisit par un lien reçu par e-mail, depuis « Mot de passe oublié ou première connexion ». Le lien vaut une heure et ne sert qu'une fois.
- **Compte Microsoft** : activé quand `MS_TENANT_ID`, `MS_CLIENT_ID` et `MS_CLIENT_SECRET` sont renseignés. L'application est à déclarer dans Entra ID en mono-locataire, avec l'adresse de redirection `<APP_URL>/api/auth/microsoft/retour`. À la première connexion, le compte Microsoft est rattaché au collaborateur qui a la même adresse e-mail ; aucun compte n'est créé automatiquement.

La session est un cookie `HttpOnly`, valable 12 heures par défaut (`SESSION_DUREE_HEURES`). En production, `APP_URL` doit être en HTTPS : le cookie n'est pas envoyé en HTTP.

Le premier directeur se crée en ligne de commande, une fois la pile démarrée :

```bash
docker compose exec api node scripts/creer-directeur.js directeur@exemple.fr Prénom Nom
```

La commande crée l'équipe « Direction », le directeur, et affiche un lien valable 72 heures pour choisir son mot de passe. Elle refuse de s'exécuter s'il existe déjà un directeur.

| Route | Rôle |
| --- | --- |
| `POST /api/auth/connexion` | Connexion par e-mail et mot de passe |
| `POST /api/auth/deconnexion` | Fermeture de la session |
| `GET /api/auth/moi` | Profil de la personne connectée |
| `GET /api/auth/config` | Indique si la connexion Microsoft est activée |
| `POST /api/auth/mot-de-passe/oubli` | Envoi du lien par e-mail |
| `POST /api/auth/mot-de-passe/definir` | Choix du mot de passe avec le lien |
| `GET /api/auth/microsoft` et `/retour` | Connexion par compte Microsoft |

Dans le code de l'API, une route se protège avec `preHandler: [app.authentifier, app.exigerRole('directeur')]`.

## Administration

Les directeurs disposent de trois écrans, accessibles depuis le bandeau :

- **Collaborateurs** : création avec invitation par e-mail, modification, changement d'équipe et de rôle, désactivation. Un collaborateur ne se supprime pas.
- **Équipes** : arborescence, responsable et délégués de chaque équipe.
- **Types d'absence** : libellé, approbation requise, confidentialité, délai de prévenance.

Les routes correspondantes sont sous `/api/admin` et répondent 403 à tout autre rôle. Garde-fous appliqués par l'API :

- Un directeur ne peut ni se désactiver ni changer son propre rôle : il reste donc toujours un directeur actif.
- Le responsable et les délégués d'une équipe doivent être actifs, avec le rôle responsable ou directeur.
- Le responsable d'une équipe ne peut être ni rétrogradé ni désactivé tant qu'un autre n'est pas désigné. Ses délégations, elles, sont retirées automatiquement.
- Désactiver un collaborateur ferme ses sessions.
- Une équipe ou un type d'absence déjà utilisés ne se suppriment pas : ils se désactivent.

## Calendrier et durée des demandes

La durée d'une demande se compte en demi-journées ouvrées : du lundi au vendredi, hors jours fériés et hors jours imposés qui concernent l'équipe du collaborateur. Une demi-journée de début ou de fin sur un jour non travaillé ne retire rien.

Les directeurs administrent le calendrier depuis l'écran « Calendrier » :

- **Jours fériés** : les onze jours légaux de France métropolitaine sont préremplis pour chaque année, à la première consultation, et pour l'année en cours et la suivante au démarrage de l'API. Un jour supprimé (journée de solidarité, par exemple) n'est pas recréé de lui-même ; le bouton « Rétablir les jours légaux » ne remet que les jours manquants. L'Alsace-Moselle (Vendredi saint, Saint-Étienne) n'est pas préremplie : ces jours s'ajoutent à la main.
- **Jours imposés** : ponts et fermetures, pour toute l'entreprise ou pour une équipe et ses sous-équipes, avec ou sans décompte des congés. Le décompte effectif sur les soldes viendra avec les compteurs.

Routes ouvertes à toute personne connectée : `GET /api/calendrier?debut=&fin=` (jours non travaillés de son équipe) et `POST /api/calendrier/duree` (durée d'une absence, à afficher avant la soumission). La durée définitive sera calculée par le serveur à la soumission et figée avec la demande.

## Comptes de base de données

- `absences_owner` : propriétaire du schéma, réservé aux migrations.
- `absences_app` : compte utilisé par l'API. Il ne possède aucun objet ; ses droits lui viennent du groupe `absences_api`, auquel les migrations accordent les droits table par table.

Le script `db/init/01-roles.sh` ne s'exécute qu'à la création du volume `db-data`. Changer un mot de passe dans `.env` après coup ne modifie pas la base.

## État

La structure Docker, le schéma de base de données, l'authentification et l'administration des collaborateurs, des équipes et des types d'absence sont en place. Le calendrier (jours fériés, jours imposés, calcul de la durée) l'est aussi. Restent à développer : les paramètres (conservation, PDF), les demandes, la validation, le planning, les e-mails avec PDF et l'export.
