import { ajouterMois } from '../calendrier/dates.js';

export const DUREE_MIN_MOIS = 1;
export const DUREE_MAX_MOIS = 120;

// Verrou propre à la purge : deux processus ne purgent jamais en même temps. La forme à deux entiers évite toute
// collision avec le verrou posé sur chaque demande par le journal.
const VERROU = [7305, 1];

// Durée de conservation réglée par les directeurs, en mois. Une valeur inutilisable arrête la purge :
// mieux vaut ne rien supprimer que supprimer selon une durée incertaine.
export async function lireDuree(db) {
  const { rows } = await db.query(`SELECT valeur FROM parametres WHERE cle = 'conservation_passe_mois'`);
  const mois = rows[0]?.valeur;
  if (!Number.isInteger(mois) || mois < DUREE_MIN_MOIS || mois > DUREE_MAX_MOIS) {
    throw new Error(`Durée de conservation invalide : ${JSON.stringify(mois ?? null)}`);
  }
  return mois;
}

// Ce qu'une durée supprimerait aujourd'hui : les demandes terminées avant la date limite, avec leur journal.
export async function apercu(db, { mois, aujourdhui }) {
  const dateLimite = ajouterMois(aujourdhui, -mois);
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM demandes WHERE date_fin < $1) AS demandes,
            (SELECT count(*)::int FROM evenements_demande
             WHERE demande_id IN (SELECT id FROM demandes WHERE date_fin < $1)) AS evenements`,
    [dateLimite],
  );
  return { mois, dateLimite, demandes: rows[0].demandes, evenements: rows[0].evenements };
}

// Supprime les demandes terminées avant la date limite (aujourd'hui moins la durée de conservation), avec leur journal
// et leurs envois d'e-mail, puis consigne la purge. Tout se fait dans une seule transaction : en cas d'échec,
// rien n'est supprimé ni consigné.
//
// Renvoie null quand rien n'a été fait : une autre purge est en cours, ou, avec `unParJour`, celle du jour est déjà faite.
export async function purger(pool, { aujourdhui, origine, unParJour = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const verrou = await client.query('SELECT pg_try_advisory_xact_lock($1, $2) AS pris', VERROU);
    if (!verrou.rows[0].pris) {
      await client.query('ROLLBACK');
      return null;
    }
    if (unParJour) {
      const deja = await client.query(`SELECT 1 FROM purges WHERE origine = 'automatique' AND jour = $1`, [aujourdhui]);
      if (deja.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
    }
    const mois = await lireDuree(client);
    const { dateLimite, evenements } = await apercu(client, { mois, aujourdhui });
    const { rows } = await client.query('SELECT purger_demandes($1::date) AS n', [dateLimite]);
    await client.query(
      `INSERT INTO purges (jour, avant, demandes_supprimees, evenements_supprimes, origine) VALUES ($1, $2, $3, $4, $5)`,
      [aujourdhui, dateLimite, rows[0].n, evenements, origine],
    );
    await client.query('COMMIT');
    return { mois, avant: dateLimite, demandesSupprimees: rows[0].n, evenementsSupprimes: evenements, origine };
  } catch (erreur) {
    await client.query('ROLLBACK').catch(() => {});
    // Une autre purge automatique du même jour a gagné la course : rien à faire.
    if (erreur.code === '23505' && erreur.constraint === 'purges_automatique_jour') return null;
    throw erreur;
  } finally {
    client.release();
  }
}

// Ménage courant, sans conséquence pour les données métier : sessions expirées et liens de mot de passe périmés.
export async function entretien(pool) {
  const sessions = await pool.query('DELETE FROM sessions WHERE expire_le < now()');
  const jetons = await pool.query(`DELETE FROM jetons_mot_de_passe WHERE expire_le < now() - interval '7 days'`);
  return { sessions: sessions.rowCount, jetons: jetons.rowCount };
}

export async function dernieresPurges(db, limite = 20) {
  const { rows } = await db.query(
    `SELECT id, executee_le, avant, demandes_supprimees, evenements_supprimes, origine
     FROM purges ORDER BY id DESC LIMIT $1`,
    [limite],
  );
  return rows.map((p) => ({
    id: Number(p.id),
    executeeLe: p.executee_le,
    avant: p.avant,
    demandesSupprimees: p.demandes_supprimees,
    evenementsSupprimes: p.evenements_supprimes,
    origine: p.origine,
  }));
}
