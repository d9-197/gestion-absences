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

La session est un cookie `HttpOnly`, valable 12 heures par défaut (`SESSION_DUREE_HEURES`). Les navigateurs n'acceptent un cookie `Secure` qu'en HTTPS : par défaut, le cookie est `Secure` seulement si `APP_URL` commence par `https://`. `APP_URL` doit être l'adresse saisie dans le navigateur, port compris. En HTTP (essais sur le réseau local), la connexion fonctionne mais mots de passe et sessions circulent en clair : l'API le signale au démarrage, et la production doit passer par HTTPS. `COOKIE_SECURE=true` ou `false` force le réglage, mais `true` avec une adresse HTTP rend toute connexion impossible.

Le premier directeur se crée en ligne de commande, une fois la pile démarrée :

```bash
docker compose exec api node scripts/creer-directeur.js directeur@exemple.fr Prénom Nom
```

La commande crée l'équipe « Direction », le directeur, et affiche un lien valable 72 heures pour choisir son mot de passe. Elle refuse de s'exécuter s'il existe déjà un directeur.

Pour essayer l'outil avec les comptes déjà créés, sans dépendre de l'envoi d'e-mails (serveur SMTP non configuré, par exemple), un second script génère les liens à la main :

```bash
docker compose exec api node scripts/lien-mot-de-passe.js                      # liste les comptes et leur accès
docker compose exec api node scripts/lien-mot-de-passe.js alice@exemple.fr     # lien pour un compte
docker compose exec api node scripts/lien-mot-de-passe.js --sans-mot-de-passe  # liens pour tous les comptes sans accès
```

Chaque lien vaut 72 heures et ne sert qu'une fois. Il n'existe volontairement pas d'équivalent dans l'application : un directeur ne peut pas y fixer le mot de passe d'une autre personne. Pour tester plusieurs rôles à la fois, ouvrez une fenêtre de navigation privée par compte : la session est un cookie, partagé entre les onglets d'un même navigateur.

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

## Demandes d'absence

**Saisie.** Un collaborateur saisit ses propres absences, à la demi-journée. Un responsable, un délégué ou un directeur peut saisir pour une personne qu'il peut valider ; la demande garde la trace de qui l'a saisie. Avant l'envoi, l'écran affiche la durée calculée et les avertissements (chevauchement à la demi-journée près, date passée, délai de prévenance non respecté, période sans jour ouvré). Les avertissements ne bloquent pas : ils sont recalculés par le serveur et conservés avec la demande.

**Circuit.** Un type avec approbation donne une demande « en attente » ; un type sans approbation donne une déclaration « enregistrée » directement. Un seul niveau de validation, et le premier valideur qui la traite décide.

**Qui valide.** La fonction SQL `valideurs_de(collaborateur)` donne les personnes habilitées : le responsable de l'équipe du collaborateur et de chaque équipe parente, leurs délégués, et tous les directeurs. Elle exclut toujours le collaborateur lui-même. Le responsable d'une équipe n'est pas validé par sa propre équipe (ni par son délégué) : sa demande remonte à l'équipe parente, à défaut aux directeurs. Si le responsable et le délégué sont absents, la demande reste visible de toute la chaîne au-dessus : aucune relance particulière n'est nécessaire.

**Refus, retrait, annulation.** Le motif d'un refus est obligatoire. Le collaborateur ou la personne qui a saisi peut retirer une demande tant qu'elle est en attente. Une absence approuvée ou enregistrée se supprime en créant une demande d'annulation, liée à l'originale et validée par le même circuit ; l'absence passe à « annulée » quand l'annulation est approuvée.

**Règles qui bloquent** (contrairement aux avertissements) : période incohérente, plus de 366 jours, date au-delà de l'horizon de saisie ou plus ancienne que la durée de conservation (12 mois par défaut, réglables dans `parametres`), type désactivé, collaborateur désactivé, et demande qu'aucun autre valideur ne pourrait traiter.

| Route | Rôle |
| --- | --- |
| `GET /api/demandes?portee=mes\|gerees&statut=` | Mes demandes, ou celles que je peux traiter |
| `GET /api/demandes/:id` | Détail et journal |
| `GET /api/demandes/compteur` | Nombre de demandes en attente de ma décision |
| `GET /api/demandes/types`, `/collaborateurs` | Types proposés, personnes pour lesquelles je peux saisir |
| `POST /api/demandes/previsualisation` | Durée et avertissements, sans rien enregistrer |
| `POST /api/demandes` | Soumission |
| `POST /api/demandes/:id/decision` | Approbation ou refus |
| `POST /api/demandes/:id/retrait`, `/annulation` | Retrait, demande d'annulation |

Une demande n'est visible que de son collaborateur, de la personne qui l'a saisie et de ses valideurs : les autres reçoivent « introuvable ». « Aujourd'hui » se calcule dans le fuseau de l'entreprise (`FUSEAU`, `Europe/Paris` par défaut) et non celui du serveur.

## Comptes de base de données

- `absences_owner` : propriétaire du schéma, réservé aux migrations.
- `absences_app` : compte utilisé par l'API. Il ne possède aucun objet ; ses droits lui viennent du groupe `absences_api`, auquel les migrations accordent les droits table par table.

Le script `db/init/01-roles.sh` ne s'exécute qu'à la création du volume `db-data`. Changer un mot de passe dans `.env` après coup ne modifie pas la base.

## État

La structure Docker, le schéma de base de données, l'authentification et l'administration des collaborateurs, des équipes et des types d'absence sont en place. Le calendrier et le circuit des demandes (saisie, validation, retrait, annulation) le sont aussi. Restent à développer : les e-mails de notification et le PDF de décision, le planning, l'export et les paramètres (conservation, mentions du PDF).
