import { ErreurMetier } from '../erreurs.js';
import { ajouterJours, ajouterMois } from '../calendrier/dates.js';
import { contexteJours } from '../suivi/service.js';

export const MENTION_INDICATIF = 'Indicatif : les soldes figurant sur les bulletins de paie font foi.';
const PROFONDEUR_REPORT = 2; // le report remonte au plus de deux périodes ; au-delà, un recalage corrige

const arrondi = (n) => Math.round(n * 100) / 100;

export async function compteursActifs(db) {
  const { rows } = await db.query(`SELECT valeur FROM parametres WHERE cle = 'compteurs_actifs'`);
  return rows[0]?.valeur === true;
}

// La période de référence qui contient `jour` : elle commence le 1er du mois `moisDebut`.
export function debutPeriode(jour, moisDebut) {
  const annee = Number(jour.slice(0, 4));
  const mois = Number(jour.slice(5, 7));
  return `${mois >= moisDebut ? annee : annee - 1}-${String(moisDebut).padStart(2, '0')}-01`;
}
export const finPeriode = (debut) => ajouterJours(ajouterMois(debut, 12), -1);

// Nombre de 1er du mois dans ]apres, jusqua] : l'acquisition se crédite le 1er de chaque mois.
function premiersDuMois(apres, jusqua) {
  let n = 0;
  for (let d = ajouterMois(`${apres.slice(0, 7)}-01`, 1); d <= jusqua; d = ajouterMois(d, 1)) n++;
  return n;
}

// Demi-journées ouvrées du type, approuvées ou en attente, dans [debut, fin] et après `apres` (exclu).
function consommation(jours, typeId, apres, debut, fin) {
  let pris = 0;
  let attente = 0;
  for (const j of jours) {
    if (j.jour < debut || j.jour > fin || (apres && j.jour <= apres)) continue;
    for (const demi of [j.matin, j.apresMidi]) {
      if (demi && demi.typeId === typeId) { if (demi.statut === 'en_attente') attente++; else pris++; }
    }
  }
  return { pris: pris / 2, attente: attente / 2 };
}

// Le solde d'une période, acquisition comptée jusqu'à `jusqua`.
//   - Avec un recalage dans la période : on part de ce chiffre, on ajoute l'acquisition des mois suivants et on retire
//     les absences posées après la date du recalage.
//   - Sans recalage : report de la période précédente (automatique : tout le reliquat positif ; sinon la valeur
//     saisie par un directeur) + acquisition depuis le début de la période − absences de la période.
function etatPeriode(ctx, debut, jusqua, profondeur) {
  const fin = finPeriode(debut);
  const ancre = ctx.recalages.find((r) => r.dateEffet >= debut && r.dateEffet <= jusqua) ?? null;
  const parMois = ctx.dotation / 12;
  let report = 0;
  let base;
  let acquis;
  let connu = Boolean(ancre); // le chiffre de départ repose sur un recalage, directement ou par report
  if (ancre) {
    base = ancre.joursRestants;
    acquis = premiersDuMois(ancre.dateEffet, jusqua) * parMois;
  } else {
    if (!ctx.type.reportAutomatique) report = ctx.reports.get(debut) ?? 0;
    else if (profondeur > 0) {
      // Sans recalage dans la période précédente, son solde est inconnu : on ne reporte rien plutôt que d'inventer un chiffre.
      const precedent = ajouterMois(debut, -12);
      const avant = etatPeriode(ctx, precedent, finPeriode(precedent), profondeur - 1);
      if (avant.connu) { report = Math.max(0, avant.solde); connu = true; }
    }
    base = report;
    acquis = premiersDuMois(ajouterJours(debut, -1), jusqua) * parMois;
  }
  const { pris, attente } = consommation(ctx.jours, ctx.type.id, ancre?.dateEffet ?? null, debut, fin);
  return {
    debut, fin, report: arrondi(report), base: arrondi(base), acquis: arrondi(acquis), pris, attente,
    solde: arrondi(base + acquis - pris - attente), recalage: ancre, connu,
  };
}

// Les soldes d'un salarié pour les types dont le compteur est actif et pour lesquels un droit est défini.
// `au` : date jusqu'à laquelle l'acquisition est comptée (aujourd'hui par défaut) ; la période est celle qui contient `au`.
export async function soldesDe(db, { collaborateurId, aujourdhui, au = aujourdhui, ignorerDemandeId = null }) {
  const types = (await db.query(
    `SELECT t.id, t.libelle, t.debut_periode_mois, t.report_automatique,
            COALESCE(d.jours, t.dotation_annuelle) AS dotation, d.jours IS NOT NULL AS dotation_personnelle
     FROM types_absence t
     LEFT JOIN LATERAL (SELECT jours FROM dotations_collaborateur WHERE collaborateur_id = $1 AND type_id = t.id ORDER BY id DESC LIMIT 1) d ON true
     WHERE t.compteur_actif AND t.actif
     ORDER BY t.ordre, lower(t.libelle)`,
    [collaborateurId],
  )).rows.filter((t) => t.dotation !== null);
  if (!types.length) return [];

  const [recalages, reports] = await Promise.all([
    db.query(`SELECT type_id, date_effet, jours_restants, id FROM recalages_solde WHERE collaborateur_id = $1 ORDER BY date_effet DESC, id DESC`, [collaborateurId]),
    db.query(`SELECT DISTINCT ON (type_id, periode_debut) type_id, periode_debut, jours FROM reports_solde WHERE collaborateur_id = $1 ORDER BY type_id, periode_debut, id DESC`, [collaborateurId]),
  ]);
  const periodes = types.map((t) => debutPeriode(au, t.debut_periode_mois));
  const debutMin = ajouterMois(periodes.reduce((a, b) => (a < b ? a : b)), -12 * PROFONDEUR_REPORT);
  const finMax = types.map((t, i) => finPeriode(periodes[i])).reduce((a, b) => (a > b ? a : b));
  const { jours } = await contexteJours(db, { collaborateurId, debut: debutMin, fin: finMax, ignorerDemandeId });

  return types.map((t, i) => {
    const type = { id: Number(t.id), reportAutomatique: t.report_automatique };
    const ctx = {
      type, dotation: Number(t.dotation), jours,
      recalages: recalages.rows.filter((r) => Number(r.type_id) === type.id).map((r) => ({ dateEffet: r.date_effet, joursRestants: Number(r.jours_restants) })),
      reports: new Map(reports.rows.filter((r) => Number(r.type_id) === type.id).map((r) => [r.periode_debut, Number(r.jours)])),
    };
    const etat = etatPeriode(ctx, periodes[i], au, PROFONDEUR_REPORT);
    return {
      typeId: type.id, libelle: t.libelle, reportAutomatique: t.report_automatique,
      dotation: Number(t.dotation), dotationPersonnelle: t.dotation_personnelle,
      periode: { debut: etat.debut, fin: etat.fin }, au,
      report: etat.report, acquis: etat.acquis, pris: etat.pris, enAttente: etat.attente, solde: etat.solde,
      recalage: etat.recalage && { dateEffet: etat.recalage.dateEffet, joursRestants: etat.recalage.joursRestants },
    };
  });
}

// Avertissement (non bloquant) quand une demande dépasse le solde indicatif acquis à son début.
export async function avertissementSolde(db, { collaborateurId, type, dateDebut, duree, aujourdhui, ignorer }) {
  if (!type.compteur_actif || !duree || !(await compteursActifs(db))) return null;
  const au = dateDebut > aujourdhui ? dateDebut : aujourdhui;
  const solde = (await soldesDe(db, { collaborateurId, aujourdhui, au, ignorerDemandeId: ignorer }))
    .find((s) => s.typeId === Number(type.id));
  // La demande doit tomber dans la période du solde calculé ; sinon on ne peut pas en juger.
  if (!solde || dateDebut < solde.periode.debut || dateDebut > solde.periode.fin) return null;
  const jours = duree / 2;
  if (solde.solde - jours >= 0) return null;
  const nombre = (n) => n.toLocaleString('fr-FR');
  return {
    code: 'solde_insuffisant',
    message: `Solde indicatif insuffisant en « ${type.libelle} » : ${nombre(solde.solde)} j disponibles au ${dateDebut.split('-').reverse().join('/')}, cette demande en compte ${nombre(jours)} j. ${MENTION_INDICATIF}`,
  };
}

// Recalage par le salarié (ou un directeur) : « à cette date, il me reste N jours à poser ».
export async function recalerSolde(db, { collaborateurId, typeId, dateEffet, joursRestants, auteurId, aujourdhui }) {
  if (!(await compteursActifs(db))) throw new ErreurMetier(409, 'Les compteurs de congés ne sont pas activés');
  const { rows } = await db.query('SELECT debut_periode_mois FROM types_absence WHERE id = $1 AND compteur_actif AND actif', [typeId]);
  if (!rows.length) throw new ErreurMetier(400, "Ce type d'absence n'a pas de compteur");
  if (dateEffet > aujourdhui) throw new ErreurMetier(400, 'La date du recalage ne peut pas être dans le futur');
  if (dateEffet < debutPeriode(aujourdhui, rows[0].debut_periode_mois)) {
    throw new ErreurMetier(400, 'La date du recalage doit être dans la période de référence en cours');
  }
  if (Math.round(joursRestants * 2) !== joursRestants * 2) throw new ErreurMetier(400, 'Le solde se saisit par demi-journée');
  await db.query(
    `INSERT INTO recalages_solde (collaborateur_id, type_id, date_effet, jours_restants, auteur_id) VALUES ($1, $2, $3, $4, $5)`,
    [collaborateurId, typeId, dateEffet, joursRestants, auteurId],
  );
}
