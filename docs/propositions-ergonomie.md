# Propositions d'ergonomie en attente

Ce fichier garde les propositions faites le 18 novembre 2026 qui n'ont pas encore été réalisées, pour les reprendre avec la direction. L'effort est indicatif : **S** = quelques heures, **M** = une journée environ, **L** = plusieurs jours.

Déjà réalisées : arrivée sur le planning, ligne de l'utilisateur en premier, clic sur un jour pour poser une absence (fusionné sur `main`), puis le lot « tous profils » et « collaborateur » (voir l'historique du dépôt).

## À proposer à la direction : responsable ou délégué

| Proposition | Effort | Remarques |
| --- | --- | --- |
| **Couverture de l'équipe dans « À traiter »** : pour chaque demande, les autres absences de l'équipe sur la période | M | La plus utile à la décision. Les données sont déjà visibles d'un valideur. |
| **Tri par urgence** (début le plus proche en premier) et filtre par personne ou équipe dans « À traiter » | S | |
| **Approuver ou refuser depuis le planning en un geste** | S | Déjà possible en deux clics : case hachurée, puis détail. |
| **Approbation en lot** | S | Décisions irréversibles : à réserver aux demandes sans avertissement, avec une confirmation récapitulative. |
| **Délégation avec dates** (automatique pendant les congés du responsable) | M | Corrige une limite connue : une délégation n'a aujourd'hui pas de dates. |
| **Résumé quotidien et relances** : un e-mail par jour au lieu d'un par demande, relance au valideur puis à l'échelon supérieur après N jours | M | |

## À proposer à la direction : directeur

| Proposition | Effort | Remarques |
| --- | --- | --- |
| **Tableau de bord** : absents du jour et de la semaine, demandes en attente depuis plus de N jours, e-mails en échec, prochaine purge | M | Double en partie le planning : le placer en bandeau au-dessus plutôt qu'en page séparée. |
| **Modèles d'export** et raccourci « mois précédent » (paie) | S | |
| **Journal des modifications d'administration** (qui a changé quel rôle, désactivé qui) | M | Manque de gouvernance plus que de confort : rien ne le trace aujourd'hui. |
| **Jours imposés par plage**, ou copiés d'une année sur l'autre | S | |
| **Import CSV des collaborateurs** | M | Utile une seule fois, à la mise en route ; avec moins de 50 personnes, la saisie à la main reste possible. |
| ~~Éditeur d'équipes par glisser-déposer~~ | L | **Déconseillé** : valeur faible pour moins de 50 personnes. |

## À proposer à la direction : collaborateur (non réalisé dans le lot 1)

| Proposition | Effort | Pourquoi pas encore |
| --- | --- | --- |
| **Solde de congés visible à la saisie** | L | Dépend de la phase 2 (compteurs), qui n'existe pas. |
| **Alerte de couverture** (« 2 collègues déjà absents ces jours-là ») | M | **Décision à prendre** : elle contredit la règle validée selon laquelle un collaborateur ne voit que son propre planning. Elle ne serait possible qu'avec un simple nombre, sans noms. |

## Choix faits dans le lot 1, à revoir si besoin

- **Glisser pour choisir début et fin** : réservé à la souris. Sur écran tactile, un appui ouvre directement le formulaire avec ce jour, et la date de fin se règle dans le formulaire (deux appuis auraient alourdi le cas courant).
- **Modifier une demande en attente** : la demande est retirée et remplacée par une nouvelle, liée à elle ; l'historique des deux est conservé. Seul l'auteur de la demande peut le faire.
- **Hors périmètre, à l'état de constat** : navigation clavier complète de la grille du planning (le bouton « Nouvelle demande » reste le chemin au clavier) ; interface sans tests automatisés dans le dépôt.
