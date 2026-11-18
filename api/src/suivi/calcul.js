import { ajouterJours, estWeekEnd, numeroDemiJournee } from '../calendrier/dates.js';

export const STATUTS_ABSENCE = ['en_attente', 'approuvee', 'enregistree'];

export const joursEntre = (debut, fin) => {
  const jours = [];
  for (let j = debut; j <= fin; j = ajouterJours(j, 1)) jours.push(j);
  return jours;
};

// L'absence qui couvre une demi-journée, s'il y en a une. Une absence confirmée l'emporte sur une demande en attente.
function absenceDe(absences, jour, demi) {
  const rang = numeroDemiJournee(jour, demi);
  let trouvee = null;
  for (const a of absences) {
    if (numeroDemiJournee(a.dateDebut, a.debutDemiJournee) <= rang && numeroDemiJournee(a.dateFin, a.finDemiJournee) >= rang) {
      if (a.statut !== 'en_attente') return a;
      trouvee ??= a;
    }
  }
  return trouvee;
}

// Analyse jour par jour d'une personne sur une période.
//   nonTravailles : jours fériés et jours imposés qui s'appliquent à son équipe (les week-ends sont écartés ici) ;
//   absences      : { dateDebut, debutDemiJournee, dateFin, finDemiJournee, statut, typeId, demandeId } ;
//   retraits      : Map jour -> motif, tickets retirés par le collaborateur ;
//   teletravail   : Set des jours déclarés en télétravail.
//
// Règles : un ticket restaurant est dû un jour travaillé, sans aucune absence, même d'une demi-journée, y compris en
// attente (la demande peut être acceptée : on ne promet pas un ticket qui serait repris). Le télétravail ne l'enlève pas.
// Le télétravail ne compte que sur un jour travaillé, au moins une demi-journée.
export function analyserJours({ debut, fin, nonTravailles, absences, retraits, teletravail }) {
  return joursEntre(debut, fin).map((jour) => {
    const ouvre = !estWeekEnd(jour) && !nonTravailles.has(jour);
    const matin = ouvre ? absenceDe(absences, jour, 'matin') : null;
    const apresMidi = ouvre ? absenceDe(absences, jour, 'apres_midi') : null;
    const travaille = ouvre && !(matin && apresMidi);
    let ticket = null;
    if (ouvre && !matin && !apresMidi) ticket = retraits.has(jour) ? 'retire' : 'oui';
    return {
      jour, ouvre, matin, apresMidi,
      ticket,
      motifRetrait: ticket === 'retire' ? retraits.get(jour) ?? null : null,
      teletravail: travaille && teletravail.has(jour),
    };
  });
}

// Le suivi (tickets retirés, télétravail) de plusieurs personnes sur une période, d'après l'état courant.
export async function lireSuivi(db, { ids, debut, fin }) {
  const { rows } = await db.query(
    `SELECT collaborateur_id, objet, jour, action, motif FROM suivi_actuel
     WHERE collaborateur_id = ANY($1) AND jour BETWEEN $2 AND $3 AND action IN ('retrait', 'declaration')`,
    [ids, debut, fin],
  );
  const parPersonne = new Map(ids.map((id) => [Number(id), { retraits: new Map(), teletravail: new Set() }]));
  for (const r of rows) {
    const suivi = parPersonne.get(Number(r.collaborateur_id));
    if (r.objet === 'ticket') suivi.retraits.set(r.jour, r.motif); else suivi.teletravail.add(r.jour);
  }
  return parPersonne;
}
