# Propositions d'ergonomie en attente

Ce fichier garde les propositions faites le 18 novembre 2026 qui n'ont pas encore été réalisées, pour les reprendre avec la direction. L'effort est indicatif : **S** = quelques heures, **M** = une journée environ, **L** = plusieurs jours.

Déjà réalisées : arrivée sur le planning, ligne de l'utilisateur en premier, clic sur un jour pour poser une absence, le lot « tous profils » et « collaborateur » (fusionnés sur `main`), puis le lot « responsable » et « directeur » (branche `ergonomie-lot-2`). Restent ci-dessous les seules propositions non réalisées.

## Non réalisé : responsable ou directeur

| Proposition | Effort | Remarques |
| --- | --- | --- |
| **Approuver ou refuser depuis le planning en un geste** | S | Déjà possible en deux clics (case hachurée, puis détail), avec la couverture d'équipe sous les yeux. Gain marginal, non réalisé. |
| **Délégation automatique pendant les congés du responsable** | M | Le lot 2 donne des dates à la délégation, saisies à la main. L'activation automatique d'après les absences approuvées du responsable n'est pas faite. |
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
