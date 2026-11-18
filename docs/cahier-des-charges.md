# Gestion des absences – mini cahier des charges

Version du 15 novembre 2026

## 1. Contexte et objectifs

L'outil remplace l'intranet actuel et la feuille imprimée par une application où une demande d'absence, une fois soumise, ne peut plus être modifiée.

- **Structure** : moins de 50 collaborateurs, en France, outil interne.
- **Situation actuelle** : les demandes sont saisies dans un intranet, puis imprimées et signées par le valideur. L'impression sert de preuve, car les collaborateurs sont des développeurs qui peuvent accéder aux données de l'outil actuel.
- **Objectif de la phase 1** : tracer les demandes et les approbations de façon fiable, sans papier.
- **Phase 2** : gestion des compteurs de congés (hors périmètre ici).

Toutes les propositions faites pendant l'échange ont été confirmées.

## 2. Périmètre de la phase 1

| Inclus | Exclu pour l'instant |
| --- | --- |
| Saisie des demandes et déclarations d'absence, à la demi-journée | Compteurs et soldes de congés |
| Validation par le responsable d'équipe, son délégué ou la hiérarchie au-dessus | Pièces jointes et justificatifs |
| Liste administrable des types d'absences | Saisie en heures |
| Calendrier : week-ends, jours fériés, jours non travaillés imposés | Import des collaborateurs depuis Microsoft 365 |
| Calcul de la durée de chaque demande en jours ouvrés | Règles bloquantes à la saisie |
| Planning des absences | Synchronisation avec les agendas |
| Notifications par e-mail et liste « à traiter » | Lien avec la paie |
| E-mail avec PDF paramétrable à chaque décision | Reprise des données de l'intranet actuel |
| Export des absences | |
| Gestion manuelle des collaborateurs, équipes et délégations | |

## 3. Rôles et droits

Trois rôles, plus une fonction de délégué qui s'exerce avec le rôle responsable.

| Action | Collaborateur | Responsable ou délégué | Directeur |
| --- | --- | --- | --- |
| Saisir ses propres demandes | Oui | Oui | Oui |
| Saisir une absence pour un autre | Non | Oui, pour ses équipes et leurs sous-équipes | Oui |
| Approuver ou refuser | Non | Oui, pour ses équipes et leurs sous-équipes | Oui |
| Voir le planning | Le sien uniquement | Ses équipes et leurs sous-équipes | Toute l'entreprise |
| Voir le type d'une absence confidentielle (maladie) | La sienne | Oui, pour les collaborateurs qu'il peut valider | Oui |
| Recevoir le PDF de décision | Oui, pour ses demandes | Oui, s'il est le valideur | Oui, tous les directeurs |
| Administrer types, calendrier, équipes, collaborateurs, délégations, mentions du PDF | Non | Non | Oui |
| Exporter | Non | Oui, pour ses équipes | Oui |

Le rôle directeur peut être attribué à plusieurs personnes. L'accès technique au serveur et à la base de données reste réservé à la direction.

## 4. Organisation

Les collaborateurs et les équipes sont saisis à la main par le directeur.

- Un collaborateur appartient à une seule équipe.
- Les équipes sont arborescentes : une équipe peut avoir une équipe parente.
- Chaque équipe a un responsable, qui est son valideur.
- Le responsable d'une équipe parente voit et valide aussi les sous-équipes, à tous les niveaux.
- Un délégué, lui-même doté du rôle responsable, peut valider à la place du responsable. Il a les mêmes droits que lui sur les équipes déléguées.
- Les demandes d'un responsable sont validées par le responsable de l'équipe parente, ou à défaut par un directeur.
- Un directeur valide lui-même ses propres demandes (décision du 18 novembre 2026), avec les autres directeurs s'il y en a. La décision est tracée à son nom et le PDF part à tous les directeurs.
- Un collaborateur désactivé (départ) ne peut plus se connecter, mais ses demandes restent consultables jusqu'à leur purge.

## 5. Types d'absences

La liste des types est administrable par le directeur ; aucun type n'est codé en dur.

Liste de départ : congés payés, congés spéciaux, RTT, maladie, sans solde, jour non travaillé (temps partiel).

Les collaborateurs à temps partiel sans jour fixe déclarent leurs jours non travaillés avec ce dernier type, sans approbation : l'accord est donné en dehors de l'outil.

| Paramètre d'un type | Effet |
| --- | --- |
| Libellé | Nom affiché à la saisie et dans les exports |
| Approbation requise | Oui : la demande passe par un valideur. Non : simple déclaration, enregistrée sans validation |
| Confidentiel | Oui : le planning affiche « absent » sans le type, sauf pour le collaborateur, ses valideurs et les directeurs |
| Délai de prévenance | Nombre de jours entre la soumission et le début de l'absence ; vide = pas de contrôle |
| Actif | Un type désactivé n'est plus proposé à la saisie, mais reste visible sur les demandes passées |

Un type utilisé par au moins une demande ne peut pas être supprimé, seulement désactivé. La modification des paramètres d'un type ne change pas les demandes déjà enregistrées.

## 6. Circuit des demandes

Une demande soumise est figée : tout changement passe par une nouvelle demande, et l'originale reste dans l'historique.

**Contenu d'une demande** : collaborateur concerné, type, date de début et date de fin avec matin ou après-midi, durée calculée en jours ouvrés, commentaire libre, auteur de la saisie, date et heure de soumission.

**Qui saisit** : le collaborateur lui-même, son responsable ou le délégué. La demande garde la trace de l'auteur réel de la saisie.

**Déroulement**

1. Le collaborateur (ou son responsable) saisit et soumet la demande. La durée calculée et les avertissements éventuels s'affichent avant la soumission.
2. Si le type ne requiert pas d'approbation, la demande est enregistrée directement et le responsable est informé.
3. Sinon, elle arrive dans la liste « à traiter » du responsable de l'équipe et de son délégué, qui reçoivent un e-mail. Elle est aussi visible des responsables des équipes parentes et des directeurs.
4. Le premier valideur habilité qui la traite approuve ou refuse. Un seul niveau de validation. Le motif est obligatoire en cas de refus.
5. Si le responsable et le délégué sont absents, la demande est traitée par le niveau au-dessus, sans mécanisme particulier puisqu'il y a déjà accès.
6. La décision déclenche l'e-mail avec PDF (section 9).

**Statuts**

| Statut | Signification |
| --- | --- |
| En attente | Soumise, pas encore traitée |
| Approuvée | Validée par un valideur habilité |
| Refusée | Rejetée par un valideur habilité, avec motif |
| Enregistrée | Déclaration sans approbation |
| Retirée | Retirée par son auteur avant décision |
| Annulée | Annulée par une demande d'annulation approuvée |

**Annulation et modification** : le collaborateur crée une demande d'annulation, liée à la demande d'origine et validée par le même circuit. Une modification de dates se fait par une annulation suivie d'une nouvelle demande.

Une demande encore en attente peut être retirée par son auteur sans validation, le retrait étant tracé ; elle prend alors le statut « Retirée ».

## 7. Calendrier, durées et règles de contrôle

La durée d'une demande est comptée en jours ouvrés, du lundi au vendredi, à la demi-journée.

**Calendrier administré par les directeurs**

- Les samedis et dimanches ne sont jamais comptés.
- Les jours fériés français sont préremplis automatiquement, corrigeables par les directeurs, et ne sont pas comptés.
- Des jours non travaillés imposés (pont, fermeture) peuvent être ajoutés pour toute l'entreprise ou pour une équipe et ses sous-équipes, chacun marqué « avec décompte de congé » ou « sans décompte ».
- Ces jours apparaissent sur le planning des collaborateurs concernés. Le décompte effectif sur les soldes relève de la phase 2.

La durée est calculée à la soumission et figée avec la demande : une modification ultérieure du calendrier ne change pas les demandes déjà soumises.

**Avertissements à la saisie**

Les règles affichent un avertissement à la saisie, sans bloquer la soumission.

- **Chevauchement** : la demande recouvre une autre demande du même collaborateur, en attente, approuvée ou enregistrée.
- **Date passée** : la demande porte sur une période déjà commencée ou terminée.
- **Délai de prévenance non respecté** : la demande est soumise plus tard que le délai paramétré pour son type.
- **Durée nulle** : la période ne contient aucun jour ouvré.

Les avertissements affichés sont enregistrés avec la demande et visibles par le valideur au moment de sa décision. Les règles sont conçues pour pouvoir devenir bloquantes plus tard, par simple réglage.

## 8. Planning et liste à traiter

Le planning montre les absences par collaborateur et par jour, à la demi-journée.

- Le collaborateur voit son propre planning.
- Le responsable voit le planning de ses équipes, de leurs sous-équipes et des équipes dont il est délégué.
- Les directeurs voient toute l'entreprise.
- Une absence d'un type confidentiel apparaît comme « absent », sans le type, sauf pour le collaborateur, ses valideurs et les directeurs.
- Les jours fériés et les jours non travaillés imposés sont affichés.
- Les demandes en attente apparaissent sur le planning, distinguées visuellement des absences approuvées.

La liste « à traiter » présente au responsable ou au délégué les demandes en attente de ses équipes, avec approbation ou refus depuis la liste. Chaque collaborateur dispose aussi de la liste de ses propres demandes avec leur statut.

## 9. Notifications, preuve et traçabilité

À chaque décision, un e-mail avec un PDF récapitulatif part au collaborateur, au valideur et à tous les directeurs : c'est la copie hors de l'outil qui remplace la feuille imprimée.

**Notifications par e-mail**

| Événement | Destinataires |
| --- | --- |
| Demande soumise, en attente d'approbation | Responsable de l'équipe et délégué |
| Déclaration enregistrée sans approbation | Responsable de l'équipe ; PDF au collaborateur et aux directeurs |
| Demande approuvée ou refusée | PDF au collaborateur, au valideur et à tous les directeurs |
| Demande d'annulation soumise ou décidée | Mêmes destinataires que pour une demande |

**Contenu du PDF** : identifiant de la demande, collaborateur, équipe, type, dates et demi-journées, durée en jours ouvrés, auteur de la saisie, date et heure de soumission, avertissements affichés, décision, motif du refus, nom du valideur, date et heure de la décision, lien éventuel vers la demande annulée.

**Paramétrage du PDF** : les directeurs règlent un en-tête (logo, raison sociale) et un bloc de mentions libres, communs à tous les types d'absences.

**Traçabilité dans l'outil**

- Aucune fonction de modification ou de suppression d'une demande soumise, y compris pour le directeur.
- Un journal horodaté enregistre chaque action : soumission, décision, retrait, annulation, avec son auteur.
- Le journal ne propose que l'ajout : aucune écriture n'y est modifiée ni supprimée.

**Limites à connaître**

- La preuve repose sur la messagerie et sur le serveur SMTP interne. Elle ne tient que si les collaborateurs n'ont accès ni à l'administration de ce serveur, ni aux boîtes des valideurs et des directeurs. Cette condition est remplie aujourd'hui et doit le rester.
- Un e-mail non délivré laisse une décision sans preuve externe. L'outil signale les envois en échec aux directeurs et permet de les relancer.
- L'outil seul ne protège pas contre une modification directe en base. Cette protection vient de la restriction des accès au serveur et de la copie par e-mail.

**Conservation**

- La durée de conservation est paramétrable par les directeurs. Valeur de départ : un an avant la date du jour, un an après.
- Une demande dont la date de fin dépasse la durée paramétrée est purgée automatiquement, avec les lignes du journal qui s'y rapportent. C'est la seule suppression prévue dans l'outil.
- Une demande ne peut pas porter sur une date située à plus d'un an dans le futur.
- Les PDF déjà envoyés par e-mail ne sont pas concernés par la purge.
- Aucune reprise des données de l'intranet actuel.

## 10. Export

L'outil exporte la liste des absences sur une période choisie, dans un fichier lisible par Excel.

- Filtres : période, équipe, collaborateur, type, statut.
- Colonnes : collaborateur, équipe, type, début, fin, durée en demi-journées, statut, valideur, date de décision.
- Deux formats au choix : XLSX et CSV.

## 11. Technique

| Sujet | Choix |
| --- | --- |
| Interface | Application web en React |
| Serveur | API REST en JavaScript (Node.js, Fastify) |
| Base de données | PostgreSQL |
| Hébergement | Conteneurs Docker dans l'infrastructure interne |
| Authentification | Compte Microsoft ou mot de passe propre à l'outil, selon le collaborateur |
| E-mails | Serveur SMTP interne |
| Développement | Claude Code, dès que possible |
| Langue | Français uniquement |

**Exigences liées à l'inaltérabilité**

- L'accès au serveur, aux conteneurs, à la base et aux sauvegardes est réservé au directeur.
- Le compte de base de données utilisé par l'application n'a pas le droit de modifier ni de supprimer les lignes du journal.
- Le dépôt de code et la chaîne de déploiement sont à protéger de la même façon : celui qui peut déployer du code peut modifier les données.

**Autres exigences**

- Sauvegarde quotidienne de la base.
- Accès en HTTPS uniquement.
- Mots de passe propres à l'outil stockés sous forme hachée, avec procédure de réinitialisation par e-mail.

## 12. Points ouverts

Les points de fond sont tranchés ; il reste des vérifications et des réglages, dont aucun ne bloque le démarrage du développement.

- [ ] Durée de conservation : valeur à régler après avis de votre expert-comptable ou conseil en droit social. Les litiges sur les congés et les salaires peuvent porter sur plusieurs années, et c'est à l'employeur de prouver les congés pris.
- [ ] Valeurs des délais de prévenance par type : à régler dans l'outil après livraison.
- [ ] Texte des mentions du PDF et logo : à régler dans l'outil après livraison.

## 13. Phase 2 : compteurs

La phase 2 ajoutera les compteurs de congés ; quatre éléments de la phase 1 la préparent.

- **Durée des demandes** : déjà calculée en jours ouvrés et figée à la soumission dès la phase 1, donc imputable plus tard sur un compteur.
- **Jours imposés avec décompte** : saisis dès la phase 1, ils seront déduits des soldes en phase 2.
- **Types d'absences** : prévoir qu'un type puisse être rattaché à un compteur (congés payés, RTT) ou à aucun (maladie, sans solde, temps partiel).
- **Conservation** : une purge à un an limite l'historique disponible pour reconstituer des soldes ; à revoir au lancement de la phase 2.

Les règles d'acquisition des compteurs (convention collective, accords d'entreprise) restent à recueillir pour la phase 2.

## Tickets restaurant, télétravail et fiche RH (ajout du 18 novembre 2026)

- Un ticket restaurant est dû chaque jour travaillé sans absence, même d'une demi-journée (une demande en attente compte comme une absence). Le télétravail n'enlève pas le ticket.
- Le collaborateur peut retirer le ticket d'un jour. Il déclare lui-même ses jours de télétravail, à l'unité ou en série ; sans validation par le responsable.
- Modifiable par le collaborateur jusqu'à la fin du mois ; un directeur peut corriger après la fin du mois.
- La fiche RH mensuelle (calendrier du mois et compteurs : jours travaillés, absences par type, tickets restaurant, télétravail) se génère en PDF, individuellement ou en masse pour les responsables et les directeurs.
