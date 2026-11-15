import { annee, joursFeriesFrancais } from './dates.js';

// Années déjà vérifiées pendant la vie du processus, par connexion à la base.
const verifiees = new WeakMap();

// Préremplit les jours fériés légaux d'une année, une seule fois : les corrections des directeurs sont conservées.
export async function assurerAnnee(pool, an) {
  const connues = verifiees.get(pool) ?? verifiees.set(pool, new Set()).get(pool);
  if (connues.has(an)) return;
  const { rowCount } = await pool.query(
    'INSERT INTO annees_calendrier (annee) VALUES ($1) ON CONFLICT DO NOTHING',
    [an],
  );
  if (rowCount) await insererFeriesLegaux(pool, an);
  connues.add(an);
}

export async function insererFeriesLegaux(pool, an) {
  const feries = joursFeriesFrancais(an);
  const { rowCount } = await pool.query(
    `INSERT INTO jours_feries (jour, libelle)
     SELECT * FROM unnest($1::date[], $2::text[]) ON CONFLICT DO NOTHING`,
    [feries.map((f) => f.jour), feries.map((f) => f.libelle)],
  );
  return rowCount;
}

export async function assurerPeriode(pool, debut, fin) {
  for (let an = annee(debut); an <= annee(fin); an++) await assurerAnnee(pool, an);
}

// Jours fériés et jours imposés qui s'appliquent à une équipe sur une période.
// Un jour imposé vaut pour toute l'entreprise (equipe_id NULL) ou pour une équipe et ses sous-équipes.
export async function calendrierEquipe(pool, { equipeId, debut, fin }) {
  await assurerPeriode(pool, debut, fin);
  const [feries, imposes] = await Promise.all([
    pool.query('SELECT jour, libelle FROM jours_feries WHERE jour BETWEEN $1 AND $2 ORDER BY jour', [debut, fin]),
    pool.query(
      `SELECT jour, libelle, avec_decompte FROM jours_imposes
       WHERE jour BETWEEN $1 AND $2
         AND (equipe_id IS NULL OR $3 IN (SELECT sous_equipes(equipe_id)))
       ORDER BY jour`,
      [debut, fin, equipeId],
    ),
  ]);
  return {
    joursFeries: feries.rows,
    joursImposes: imposes.rows.map((j) => ({ jour: j.jour, libelle: j.libelle, avecDecompte: j.avec_decompte })),
  };
}

export async function joursNonTravailles(pool, periode) {
  const { joursFeries, joursImposes } = await calendrierEquipe(pool, periode);
  return new Set([...joursFeries, ...joursImposes].map((j) => j.jour));
}
