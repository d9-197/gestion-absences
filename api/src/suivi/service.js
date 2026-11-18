import { ErreurMetier, introuvable } from '../erreurs.js';
import { ajouterMois } from '../calendrier/dates.js';
import { calendrierEquipe } from '../calendrier/service.js';
import { analyserJours, lireSuivi, STATUTS_ABSENCE } from './calcul.js';

// Ce que `utilisateur` peut modifier chez `collaborateurId` : lui-même jusqu'à la fin du mois en cours (tout le mois
// courant, y compris ses jours déjà passés, et les mois à venir) ; un directeur, n'importe quel jour dans la durée de
// conservation, y compris après la fin du mois, pour corriger une saisie.
export async function cadreDeModification(db, { utilisateur, collaborateurId, aujourdhui }) {
  const directeur = utilisateur.role === 'directeur';
  if (Number(utilisateur.id) !== Number(collaborateurId) && !directeur) {
    throw new ErreurMetier(403, "Seul le collaborateur lui-même, ou un directeur, peut modifier ces informations");
  }
  const { rows } = await db.query(
    `SELECT (SELECT valeur FROM parametres WHERE cle = 'horizon_futur_mois') AS futur,
            (SELECT valeur FROM parametres WHERE cle = 'conservation_passe_mois') AS passe`,
  );
  const { futur, passe } = rows[0];
  return {
    directeur,
    // Un collaborateur ne remonte pas avant le premier jour du mois en cours ; personne ne dépasse la conservation ni l'horizon.
    plusTot: directeur ? ajouterMois(aujourdhui, -passe) : `${aujourdhui.slice(0, 7)}-01`,
    plusTard: ajouterMois(aujourdhui, futur),
  };
}

// Charge ce qu'il faut pour juger des jours d'un collaborateur : son équipe, son calendrier, ses absences, son suivi.
export async function contexteJours(db, { collaborateurId, debut, fin }) {
  const { rows } = await db.query('SELECT id, prenom, nom, equipe_id FROM collaborateurs WHERE id = $1', [collaborateurId]);
  if (!rows.length) throw introuvable('Collaborateur');
  const personne = rows[0];
  const [calendrier, absences, suivi] = await Promise.all([
    calendrierEquipe(db, { equipeId: personne.equipe_id, debut, fin }),
    db.query(
      `SELECT d.id, d.type_id, d.date_debut, d.debut_demi_journee, d.date_fin, d.fin_demi_journee, d.statut
       FROM demandes_avec_statut d
       WHERE d.collaborateur_id = $1 AND d.nature = 'absence' AND d.statut = ANY($4) AND d.date_debut <= $3 AND d.date_fin >= $2`,
      [collaborateurId, debut, fin, STATUTS_ABSENCE],
    ),
    lireSuivi(db, { ids: [collaborateurId], debut, fin }),
  ]);
  const nonTravailles = new Set([...calendrier.joursFeries, ...calendrier.joursImposes].map((j) => j.jour));
  const jours = analyserJours({
    debut, fin, nonTravailles,
    absences: absences.rows.map((a) => ({
      demandeId: Number(a.id), typeId: Number(a.type_id), statut: a.statut === 'en_attente' ? 'en_attente' : 'confirmee',
      dateDebut: a.date_debut, debutDemiJournee: a.debut_demi_journee, dateFin: a.date_fin, finDemiJournee: a.fin_demi_journee,
    })),
    ...suivi.get(Number(collaborateurId)),
  });
  return { personne, jours, calendrier, declares: suivi.get(Number(collaborateurId)).teletravail, retraits: suivi.get(Number(collaborateurId)).retraits };
}

export async function ajouterEvenements(client, { collaborateurId, auteurId, objet, action, jours, motif }) {
  if (!jours.length) return;
  await verifierJoursOuverts(client, jours);
  await client.query(
    `INSERT INTO suivi_evenements (collaborateur_id, jour, objet, action, motif, auteur_id)
     SELECT $1, j, $2, $3, $4, $5 FROM unnest($6::date[]) AS j`,
    [collaborateurId, objet, action, motif ?? null, auteurId, jours],
  );
}

// Les saisies de tickets et de télétravail ne sont plus possibles sur un mois clôturé (il faut d'abord le rouvrir).
export async function verifierJoursOuverts(db, jours) {
  const mois = [...new Set(jours.map((j) => `${j.slice(0, 7)}-01`))];
  if (!mois.length) return;
  const { rows } = await db.query(
    `SELECT to_char(mois, 'YYYY-MM') AS mois FROM clotures_actuelles WHERE action = 'cloture' AND mois = ANY($1::date[])`, [mois],
  );
  if (rows.length) throw new ErreurMetier(403, `Le mois ${rows[0].mois} est clôturé : un directeur doit le rouvrir avant toute modification`);
}
