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

Chaque lien vaut 72 heures et ne sert qu'une fois. L'application ne permet pas à un directeur de fixer le mot de passe d'une autre personne. **Mode test.** Pour essayer l'outil sans gérer de mots de passe, `AUTOLOGIN_TEST=true` dans `.env` ajoute sur la page de connexion une liste de tous les comptes actifs : on choisit un utilisateur et on est connecté sans mot de passe.

```bash
docker compose up -d api web
```

C'est une porte ouverte : **toute personne qui atteint l'adresse peut se connecter en tant que n'importe qui, directeurs compris**, et agir sous son nom (le journal des demandes ne le distingue pas). Le mode est donc désactivé par défaut, signalé par un encadré pointillé sur la page de connexion, et l'API écrit une erreur au démarrage et un avertissement à chaque connexion. À retirer de `.env` dès les essais terminés, puis `docker compose up -d api web`.

Pour tester plusieurs rôles à la fois, ouvrez une fenêtre de navigation privée par compte : la session est un cookie, partagé entre les onglets d'un même navigateur.

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

## Planning

L'écran « Planning » affiche un mois à la fois, par collaborateur et à la demi-journée, avec les jours fériés, les jours imposés de l'équipe et les week-ends. Les absences sont colorées par type ; les demandes **en attente** sont hachurées, pour se distinguer des absences confirmées (approuvées ou déclarées). Une vue en liste donne les mêmes informations sous forme de tableau, et chaque absence s'ouvre sur le détail de la demande.

**Page d'arrivée et saisie.** Le planning est la page d'arrivée après la connexion (il n'y a plus de page d'accueil) et le titre de l'application y ramène. **La ligne de la personne connectée est toujours la première**, repérée par une pastille « moi » et un fond coloré, et le filtre d'équipe ne s'applique qu'aux autres lignes. **Un clic sur un jour libre** ouvre le formulaire de demande, avec ce jour comme date de départ, la demi-journée cliquée (matin ou après-midi) comme début, et la personne de la ligne cliquée pour « Pour ». Un responsable ou un directeur peut donc poser une absence pour un collaborateur en cliquant sur sa ligne, dans la limite de ce que l'API lui permet déjà. Le bouton « Nouvelle demande » ouvre le même formulaire sans date, et reste le chemin au clavier ; sur écran tactile, les cases font au moins 24 px. Les responsables et directeurs voient en tête du planning le nombre de demandes qui attendent leur décision.

**Qui voit quoi.** Chacun voit le planning de la personne et de ceux qu'il peut valider :

| Rôle | Planning visible |
| --- | --- |
| Collaborateur | Le sien uniquement |
| Responsable ou délégué | Lui-même, son équipe et les sous-équipes, ainsi que celles dont il est délégué |
| Directeur | Toute l'entreprise |

Une personne désactivée n'apparaît que si elle a des absences sur la période affichée.

**Confidentialité.** Le serveur ne montre le type d'une absence de type confidentiel (la maladie) qu'à la personne concernée et à ses valideurs ; pour tout autre lecteur, l'absence apparaît comme « Absent », sans type ni lien vers la demande, et la légende n'en parle pas. Avec les règles de visibilité ci-dessus, les personnes qui voient le planning d'un collaborateur sont exactement celles qui peuvent voir son type : ce masquage ne se déclenche donc aujourd'hui pour personne. Il est en place, et testé, pour le jour où la visibilité serait élargie (un planning d'équipe visible de tous, par exemple).

La route `GET /api/planning?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` renvoie les personnes visibles, leurs absences, les fériés et les jours imposés par équipe, pour 100 jours au plus.

## Conservation et purge automatique

Les demandes sont conservées pendant une durée réglée par les directeurs dans l'écran « Conservation » : **12 mois par défaut**, de 1 à 120. Chaque nuit après 3 h (heure de l'entreprise), l'API **supprime définitivement** les demandes **terminées avant la date limite** (aujourd'hui moins la durée), avec leur historique et leurs envois d'e-mail. Une demande qui finit pile à la date limite est conservée, de même qu'une demande à cheval sur elle. Les PDF déjà envoyés par e-mail ne sont pas concernés : ils sont hors de l'outil.

- **Une purge par jour**, même avec plusieurs processus : un verrou en base et un index unique l'imposent. Si l'API était arrêtée à 3 h, la purge du jour a lieu dès son redémarrage ; en cas d'échec, elle est retentée toutes les 15 minutes.
- **Tout ou rien** : la purge est une seule transaction. Si la durée enregistrée est inutilisable, rien n'est supprimé et l'erreur est écrite dans les journaux.
- **Journal des purges** : chaque exécution est consignée (date, date limite, nombre de demandes et de lignes d'historique supprimées, origine). Ce journal est en ajout seul, comme celui des demandes, et visible dans l'écran « Conservation ».
- **Changer la durée ne supprime rien sur le moment** : les demandes concernées partent à la prochaine purge. L'écran annonce, avant l'enregistrement, combien de demandes une durée supprimerait, et demande une confirmation. La suppression est irréversible, y compris si la durée est rallongée ensuite.
- **Effet sur la saisie** : cette durée est aussi la limite passée de la saisie, pour ne pas créer une demande qui serait aussitôt supprimée.
- **Ménage** : la même passe nocturne supprime les sessions expirées et les liens de mot de passe périmés depuis plus de 7 jours.

Pour contrôler ou déclencher la purge à la main :

```bash
docker compose exec api node scripts/purger.js              # simulation : indique ce qui serait supprimé
docker compose exec api node scripts/purger.js --executer   # supprime vraiment, et consigne la purge
```

**Ce que la purge ne couvre pas.** Elle ne supprime que les demandes. Les fiches des collaborateurs (nom, adresse e-mail) restent, même désactivées et sans plus aucune demande : aucune règle d'effacement ou d'anonymisation n'a été définie. Les sauvegardes de la base, quand elles existeront, conserveront aussi des demandes déjà purgées. Les journaux de l'API, enfin, contiennent des noms et des identifiants.

## Export des absences

L'écran « Export » (responsables et directeurs) télécharge la liste des absences qui **touchent** la période choisie, en **Excel (.xlsx)** ou en **CSV**. Filtres : période, équipe (avec ses sous-équipes), collaborateur, type, statuts. Par défaut, seules les absences valables (approuvées ou enregistrées) sont retenues.

**Périmètre.** Un directeur exporte toute l'entreprise, y compris ses propres absences ; un responsable ou un délégué, les absences des personnes qu'il peut valider (donc pas les siennes). Un collaborateur n'a pas accès à l'export. Les filtres ne permettent pas de sortir de ce périmètre.

**Colonnes.** N° de demande, Nom, Prénom, Équipe, Type d'absence, Début et sa demi-journée, Fin et sa demi-journée, Durée en demi-journées, Statut, Valideur, Date de décision. Le valideur et la date sont ceux de la première décision (approbation, refus ou enregistrement), y compris pour une absence annulée depuis ; ils sont vides pour une demande en attente ou retirée. Les demandes d'annulation ne sont pas des lignes à part : l'absence concernée passe au statut « Annulée ». Les lignes sont triées par nom, prénom puis date de début.

**Formats.**

- **XLSX** : vrais nombres et vraies dates (`jj/mm/aaaa`, heure de l'entreprise), en-tête figé, largeurs de colonnes réglées.
- **CSV** : séparateur « ; », UTF-8 avec marque d'ordre des octets et fins de ligne CRLF, pour s'ouvrir directement dans Excel en français. Dates au format `AAAA-MM-JJ`, que tout tableur reconnaît quelle que soit sa langue ; durées en entiers, sans virgule décimale.

**Sécurité.** Un texte qui commencerait par `=`, `+`, `-` ou `@` n'est jamais exécuté comme une formule : il est préfixé d'une apostrophe dans le CSV, et stocké comme texte dans le XLSX. L'export contient des données personnelles, dont les absences pour maladie : chaque export est tracé dans les journaux de l'API (qui, période, filtres, nombre de lignes), mais le fichier téléchargé n'est plus sous le contrôle de l'outil.

`GET /api/export/absences?debut=&fin=&format=xlsx|csv&equipeId=&collaborateurId=&typeId=&statut=a,b` renvoie le fichier (période de 731 jours au plus) ; `GET /api/export/options` donne les valeurs des filtres selon le périmètre.

## E-mails et PDF de décision

L'outil envoie des e-mails à chaque étape du circuit. Les destinataires dépendent de l'événement :

| Événement | Destinataires | PDF |
| --- | --- | --- |
| Demande soumise (type avec approbation) | Les valideurs les plus proches : responsable et délégués de l'équipe du collaborateur, à défaut ceux de l'équipe parente, et ainsi de suite, à défaut les directeurs | Non |
| Demande approuvée ou refusée | Le collaborateur, la personne qui a décidé, tous les directeurs | Oui |
| Absence déclarée (type sans approbation) | Les mêmes valideurs, pour information ; le collaborateur et tous les directeurs reçoivent le PDF | Oui, sauf valideurs |
| Demande d'annulation soumise, puis décidée | Comme une demande | Comme une demande |
| Retrait d'une demande | Personne | Non |

Un même e-mail n'est envoyé qu'une fois à chaque personne, et un compte désactivé ne reçoit plus rien.

**Le PDF de décision** est la copie de référence, hors de l'outil, qui remplace la feuille imprimée. Il reprend la demande (collaborateur, équipe, type, période, durée en jours ouvrés, commentaire, auteur de la saisie, avertissements affichés), la décision (qui, quand, motif d'un refus), et, pour une annulation, la demande d'origine. Il est produit à partir du journal, qui ne change jamais : le renvoyer plus tard donne le même contenu. Les directeurs règlent la raison sociale et les mentions du bas de page dans « E-mails » ; un exemple de PDF s'y affiche en un clic. Il n'y a pas de logo pour l'instant.

**Fiabilité.** Les e-mails sont enregistrés dans la même transaction que l'événement qui les provoque, puis envoyés en arrière-plan : une panne du serveur d'e-mail ne bloque jamais une demande et ne fait perdre aucun message. Un envoi en échec est retenté deux fois (après 1 puis 5 minutes), puis marqué « en échec ». Les directeurs en sont avertis par un bandeau et relancent depuis l'écran « E-mails », une fois la cause réparée. Le suivi (destinataire, objet, nombre de tentatives, dernière erreur) y est consultable.

**Serveur d'e-mail.** `SMTP_HOST`, `SMTP_PORT` et `SMTP_FROM` suffisent pour un serveur interne ouvert. Selon le vôtre : `SMTP_USER` et `SMTP_PASSWORD` si un identifiant est exigé, `SMTP_SECURE=true` pour un TLS dès la connexion (port 465, sinon STARTTLS est utilisé quand le serveur le propose), `SMTP_TLS_VERIFIER=false` pour accepter un certificat interne non reconnu. En développement, Mailpit capture tout sur http://localhost:8025, pièces jointes comprises.

La preuve par e-mail ne vaut que si personne d'autre que les destinataires n'a accès aux boîtes ni à l'administration du serveur d'e-mail (voir le cahier des charges).

## Comptes de base de données

- `absences_owner` : propriétaire du schéma, réservé aux migrations.
- `absences_app` : compte utilisé par l'API. Il ne possède aucun objet ; ses droits lui viennent du groupe `absences_api`, auquel les migrations accordent les droits table par table.

Le script `db/init/01-roles.sh` ne s'exécute qu'à la création du volume `db-data`. Changer un mot de passe dans `.env` après coup ne modifie pas la base.

## État

La structure Docker, le schéma de base de données, l'authentification et l'administration des collaborateurs, des équipes et des types d'absence sont en place. Le calendrier et le circuit des demandes (saisie, validation, retrait, annulation) le sont aussi. Les e-mails de notification et le PDF de décision le sont aussi. Le planning et l'export le sont aussi. La purge automatique selon la durée de conservation l'est aussi : le cahier des charges est couvert. Restent des sujets hors cahier des charges, comme la sauvegarde, le HTTPS devant l'outil ou l'effacement des fiches de collaborateurs partis.
