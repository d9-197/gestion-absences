import { assurerPeriode } from '../calendrier/service.js';

const STATUTS = ['en_attente', 'approuvee', 'enregistree'];

// Les personnes dont `moi` voit le planning : lui-même et celles qu'il peut valider (responsable ou délégué de leur
// équipe ou d'une équipe parente, directeur). Un collaborateur ne voit donc que le sien.
// Une personne désactivée n'apparaît que si elle a des absences sur la période.
export async function personnesVisibles(db, { moi, debut, fin }) {
  const { rows } = await db.query(
    `SELECT c.id, c.prenom, c.nom, c.actif, c.equipe_id, e.nom AS equipe_nom
     FROM collaborateurs c JOIN equipes e ON e.id = c.equipe_id
     WHERE (c.id = $1 OR EXISTS (SELECT 1 FROM valideurs_de(c.id) v WHERE v = $1))
       AND (c.actif OR EXISTS (
         SELECT 1 FROM demandes_avec_statut d
         WHERE d.collaborateur_id = c.id AND d.nature = 'absence' AND d.statut = ANY($4)
           AND d.date_debut <= $3 AND d.date_fin >= $2))`,
    [moi, debut, fin, STATUTS],
  );
  // Tri alphabétique français (accents et casse ignorés) : celui de la base dépend de la langue du système.
  const ordre = new Intl.Collator('fr', { sensitivity: 'base' });
  return rows.sort((a, b) => ordre.compare(a.equipe_nom, b.equipe_nom) || ordre.compare(a.nom, b.nom) || ordre.compare(a.prenom, b.prenom));
}

// Le planning de `personnes` sur une période. Seules les absences valables ou en attente y figurent.
//
// Confidentialité : le type d'une absence de type confidentiel (la maladie) n'est montré qu'à la personne concernée
// et à ses valideurs ; pour tout autre lecteur l'absence apparaît sans type ni lien vers la demande.
// Les statuts sont ramenés à deux valeurs (« confirmee », « en_attente ») : « enregistree » ne vient que des types
// sans approbation et trahirait, sur une absence dont le type est masqué, la nature de ce type.
export async function construirePlanning(db, { moi, debut, fin, personnes }) {
  const ids = personnes.map((p) => Number(p.id));
  await assurerPeriode(db, debut, fin);

  const [absences, valideur, feries, imposes] = await Promise.all([
    db.query(
      `SELECT d.id, d.collaborateur_id, d.date_debut, d.debut_demi_journee, d.date_fin, d.fin_demi_journee, d.statut,
              t.id AS type_id, t.libelle, t.confidentiel
       FROM demandes_avec_statut d JOIN types_absence t ON t.id = d.type_id
       WHERE d.collaborateur_id = ANY($1) AND d.nature = 'absence' AND d.statut = ANY($4)
         AND d.date_debut <= $3 AND d.date_fin >= $2
       ORDER BY d.date_debut, d.id`,
      [ids, debut, fin, STATUTS],
    ),
    db.query(
      `SELECT c.id FROM collaborateurs c
       WHERE c.id = ANY($1) AND EXISTS (SELECT 1 FROM valideurs_de(c.id) v WHERE v = $2)`,
      [ids, moi],
    ),
    db.query('SELECT jour, libelle FROM jours_feries WHERE jour BETWEEN $1 AND $2 ORDER BY jour', [debut, fin]),
    // Jours imposés applicables à chacune des équipes présentes : toute l'entreprise, ou l'équipe et ses sous-équipes.
    db.query(
      `SELECT t.equipe_id, ji.jour, ji.libelle, ji.avec_decompte
       FROM (SELECT DISTINCT equipe_id FROM collaborateurs WHERE id = ANY($1)) t
         JOIN jours_imposes ji ON ji.jour BETWEEN $2 AND $3
          AND (ji.equipe_id IS NULL OR t.equipe_id IN (SELECT sous_equipes(ji.equipe_id)))
       ORDER BY ji.jour`,
      [ids, debut, fin],
    ),
  ]);

  const peutVoirLeType = new Set(valideur.rows.map((r) => Number(r.id)));
  const legende = new Map();
  const parPersonne = new Map(ids.map((id) => [id, []]));

  for (const a of absences.rows) {
    const collaborateurId = Number(a.collaborateur_id);
    const visible = !a.confidentiel || collaborateurId === moi || peutVoirLeType.has(collaborateurId);
    if (visible) legende.set(Number(a.type_id), a.libelle);
    parPersonne.get(collaborateurId).push({
      demandeId: visible ? Number(a.id) : null,
      dateDebut: a.date_debut,
      debutDemiJournee: a.debut_demi_journee,
      dateFin: a.date_fin,
      finDemiJournee: a.fin_demi_journee,
      statut: a.statut === 'en_attente' ? 'en_attente' : 'confirmee',
      type: visible ? { id: Number(a.type_id), libelle: a.libelle } : null,
    });
  }

  const imposesParEquipe = {};
  for (const j of imposes.rows) {
    (imposesParEquipe[j.equipe_id] ??= []).push({ jour: j.jour, libelle: j.libelle, avecDecompte: j.avec_decompte });
  }

  const equipes = new Map(personnes.map((p) => [Number(p.equipe_id), p.equipe_nom]));
  return {
    debut,
    fin,
    joursFeries: feries.rows,
    imposesParEquipe,
    equipes: [...equipes].map(([id, nom]) => ({ id, nom })),
    types: [...legende].map(([id, libelle]) => ({ id, libelle })).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr')),
    personnes: personnes.map((p) => ({
      id: Number(p.id), prenom: p.prenom, nom: p.nom, equipeId: Number(p.equipe_id), actif: p.actif,
      absences: parPersonne.get(Number(p.id)),
    })),
  };
}
