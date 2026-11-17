// Données de l'export des absences : lecture, filtres et mise en forme des lignes.

export const STATUTS = ['en_attente', 'approuvee', 'refusee', 'enregistree', 'retiree', 'annulee'];
export const LIBELLE_STATUT = {
  en_attente: 'En attente', approuvee: 'Approuvée', refusee: 'Refusée',
  enregistree: 'Enregistrée', retiree: 'Retirée', annulee: 'Annulée',
};
const DEMI_JOURNEE = { matin: 'Matin', apres_midi: 'Après-midi' };

// « texte » : colonnes de texte ; « date » : jour ; « datetime » : jour et heure ; « nombre » : entier.
export const COLONNES = [
  { titre: 'N° demande', type: 'nombre', largeur: 12 },
  { titre: 'Nom', type: 'texte', largeur: 18 },
  { titre: 'Prénom', type: 'texte', largeur: 16 },
  { titre: 'Équipe', type: 'texte', largeur: 20 },
  { titre: "Type d'absence", type: 'texte', largeur: 24 },
  { titre: 'Début', type: 'date', largeur: 12 },
  { titre: 'Début (demi-journée)', type: 'texte', largeur: 20 },
  { titre: 'Fin', type: 'date', largeur: 12 },
  { titre: 'Fin (demi-journée)', type: 'texte', largeur: 18 },
  { titre: 'Durée (demi-journées)', type: 'nombre', largeur: 20 },
  { titre: 'Statut', type: 'texte', largeur: 14 },
  { titre: 'Valideur', type: 'texte', largeur: 20 },
  { titre: 'Date de décision', type: 'datetime', largeur: 18 },
];

const ordre = new Intl.Collator('fr', { sensitivity: 'base' });

// Les absences (et non les demandes d'annulation) qui touchent la période, parmi celles que `moi` a le droit de voir :
// un directeur voit toute l'entreprise, y compris lui-même ; un responsable ou un délégué, les personnes qu'il peut valider.
// La décision est la première décision prise sur la demande (approbation, refus ou enregistrement), même si
// la demande a été annulée depuis.
export async function lireAbsences(db, { moi, directeur, debut, fin, equipeId, collaborateurId, typeId, statuts }) {
  const valeurs = [debut, fin, statuts];
  const conditions = [
    `d.nature = 'absence'`,
    'd.date_debut <= $2 AND d.date_fin >= $1',
    'd.statut = ANY($3)',
  ];
  const ajouter = (condition, valeur) => {
    valeurs.push(valeur);
    conditions.push(condition.replace('?', `$${valeurs.length}`));
  };
  if (!directeur) ajouter('EXISTS (SELECT 1 FROM valideurs_de(d.collaborateur_id) v WHERE v = ?)', moi);
  // L'équipe retenue est celle de la demande (celle de la colonne « Équipe »), avec ses sous-équipes.
  if (equipeId) ajouter('d.equipe_id IN (SELECT sous_equipes(?::bigint))', equipeId);
  if (collaborateurId) ajouter('d.collaborateur_id = ?', collaborateurId);
  if (typeId) ajouter('d.type_id = ?', typeId);

  const { rows } = await db.query(
    `SELECT d.id, c.nom, c.prenom, e.nom AS equipe, t.libelle AS type,
            d.date_debut, d.debut_demi_journee, d.date_fin, d.fin_demi_journee, d.duree_demi_journees, d.statut,
            dec.cree_le AS decision_le, v.prenom AS valideur_prenom, v.nom AS valideur_nom
     FROM demandes_avec_statut d
       JOIN collaborateurs c ON c.id = d.collaborateur_id
       JOIN equipes e ON e.id = d.equipe_id
       JOIN types_absence t ON t.id = d.type_id
       LEFT JOIN LATERAL (
         SELECT ev.cree_le, ev.auteur_id FROM evenements_demande ev
         WHERE ev.demande_id = d.id AND ev.type IN ('approbation', 'refus', 'enregistrement')
         ORDER BY ev.id LIMIT 1
       ) dec ON true
       LEFT JOIN collaborateurs v ON v.id = dec.auteur_id
     WHERE ${conditions.join(' AND ')}`,
    valeurs,
  );
  return rows.sort((a, b) =>
    ordre.compare(a.nom, b.nom) || ordre.compare(a.prenom, b.prenom) || a.date_debut.localeCompare(b.date_debut) || Number(a.id) - Number(b.id));
}

// « 2026-11-17 21:45 », dans le fuseau de l'entreprise.
const formatHeure = (valeur, fuseau) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(valeur));

// Les lignes du fichier, dans l'ordre de COLONNES. Une cellule sans valeur est `null`.
export function lignesExport(rows, fuseau = 'Europe/Paris') {
  return rows.map((r) => [
    Number(r.id),
    r.nom,
    r.prenom,
    r.equipe,
    r.type,
    r.date_debut,
    DEMI_JOURNEE[r.debut_demi_journee],
    r.date_fin,
    DEMI_JOURNEE[r.fin_demi_journee],
    r.duree_demi_journees,
    LIBELLE_STATUT[r.statut],
    r.valideur_prenom ? `${r.valideur_prenom} ${r.valideur_nom}` : null,
    r.decision_le ? formatHeure(r.decision_le, fuseau) : null,
  ]);
}
