import { ErreurMetier, introuvable } from '../erreurs.js';
import { ajouterJours, ajouterMois } from '../calendrier/dates.js';
import { contexteJours } from '../suivi/service.js';

export const bornesDuMois = (mois) => {
  const debut = `${mois}-01`;
  return [debut, ajouterJours(ajouterMois(debut, 1), -1)];
};

const demiJours = (n) => n / 2;

// La fiche RH d'un salarié pour un mois : le calendrier jour par jour et les compteurs.
//
// Les trois catégories de demi-journées ouvrées se partagent le mois sans se recouper :
//   travaillées + absences confirmées (par type) + demandes en attente = jours ouvrés × 2.
// Une demande en attente n'est donc ni comptée comme travaillée ni comme absence : la fiche est alors « provisoire ».
export async function calculerFiche(db, { collaborateurId, mois }) {
  const [debut, fin] = bornesDuMois(mois);
  const contexte = await contexteJours(db, { collaborateurId, debut, fin });
  const [types, detail, equipe] = await Promise.all([
    db.query('SELECT id, libelle, actif FROM types_absence ORDER BY ordre, lower(libelle)'),
    db.query('SELECT email, role, actif FROM collaborateurs WHERE id = $1', [collaborateurId]),
    db.query('SELECT nom FROM equipes WHERE id = $1', [contexte.personne.equipe_id]),
  ]);

  const feries = new Map(contexte.calendrier.joursFeries.map((f) => [f.jour, f.libelle]));
  const imposes = new Map(contexte.calendrier.joursImposes.map((j) => [j.jour, j.libelle]));
  const parType = new Map();
  let ouvrees = 0;
  let confirmees = 0;
  let enAttente = 0;
  let teletravail = 0;
  let tickets = 0;
  let retires = 0;

  const jours = contexte.jours.map((j) => {
    if (j.ouvre) {
      ouvrees += 2;
      let travaillees = 2;
      for (const demi of [j.matin, j.apresMidi]) {
        if (!demi) continue;
        travaillees--;
        if (demi.statut === 'en_attente') enAttente++;
        else { confirmees++; parType.set(demi.typeId, (parType.get(demi.typeId) ?? 0) + 1); }
      }
      if (j.teletravail) teletravail += travaillees;
    }
    if (j.ticket === 'oui') tickets++;
    if (j.ticket === 'retire') retires++;
    return {
      jour: j.jour, ouvre: j.ouvre, ferie: feries.get(j.jour) ?? null, impose: imposes.get(j.jour) ?? null,
      matin: j.matin ? { typeId: j.matin.typeId, statut: j.matin.statut } : null,
      apresMidi: j.apresMidi ? { typeId: j.apresMidi.typeId, statut: j.apresMidi.statut } : null,
      ticket: j.ticket, motifRetrait: j.motifRetrait, teletravail: j.teletravail,
    };
  });

  const travaillees = ouvrees - confirmees - enAttente;
  return {
    mois, debut, fin,
    collaborateur: {
      id: Number(contexte.personne.id), prenom: contexte.personne.prenom, nom: contexte.personne.nom,
      email: detail.rows[0].email, equipe: equipe.rows[0].nom,
    },
    types: types.rows.map((t) => ({ id: Number(t.id), libelle: t.libelle, actif: t.actif })),
    jours,
    compteurs: {
      joursOuvres: demiJours(ouvrees),
      joursTravailles: demiJours(travaillees),
      teletravail: demiJours(teletravail),
      surSite: demiJours(travaillees - teletravail),
      absences: types.rows
        .filter((t) => t.actif || parType.has(Number(t.id)))
        .map((t) => ({ typeId: Number(t.id), libelle: t.libelle, jours: demiJours(parType.get(Number(t.id)) ?? 0) })),
      absencesEnAttente: demiJours(enAttente),
      tickets,
      ticketsRetires: retires,
      provisoire: enAttente > 0,
    },
  };
}

// Qui peut lire la fiche de qui : chacun la sienne, un valideur celle des personnes qu'il valide, un directeur toutes.
export async function verifierAcces(db, { utilisateur, collaborateurId }) {
  const moi = Number(utilisateur.id);
  if (collaborateurId === moi || utilisateur.role === 'directeur') {
    const { rowCount } = await db.query('SELECT 1 FROM collaborateurs WHERE id = $1', [collaborateurId]);
    if (!rowCount) throw introuvable('Collaborateur');
    return;
  }
  const { rowCount } = await db.query('SELECT 1 FROM valideurs_de($1) v WHERE v = $2', [collaborateurId, moi]);
  if (!rowCount) throw introuvable('Collaborateur');
}

// Un mois valide pour une fiche : pas avant la durée de conservation (les demandes plus anciennes sont purgées), pas
// au-delà de l'horizon de saisie.
export async function verifierMois(db, { mois, aujourdhui }) {
  const { rows } = await db.query(
    `SELECT (SELECT valeur FROM parametres WHERE cle = 'horizon_futur_mois') AS futur,
            (SELECT valeur FROM parametres WHERE cle = 'conservation_passe_mois') AS passe`,
  );
  const { futur, passe } = rows[0];
  const [debut, fin] = bornesDuMois(mois);
  const limiteBasse = ajouterMois(aujourdhui, -passe);
  if (fin < limiteBasse) throw new ErreurMetier(400, `Les données de ce mois ont plus de ${passe} mois : elles ne sont plus conservées`);
  if (debut > ajouterMois(aujourdhui, futur)) throw new ErreurMetier(400, `Ce mois est à plus de ${futur} mois`);
}

// État de clôture d'un mois : null si le mois est ouvert, sinon qui l'a clôturé et quand.
export async function etatCloture(db, mois) {
  const { rows } = await db.query(
    `SELECT c.cree_le, c.action, c.auteur_id, a.prenom, a.nom
     FROM clotures_actuelles c JOIN collaborateurs a ON a.id = c.auteur_id WHERE c.mois = $1`,
    [`${mois}-01`],
  );
  if (!rows.length || rows[0].action !== 'cloture') return null;
  return { le: rows[0].cree_le.toISOString(), par: `${rows[0].prenom} ${rows[0].nom}` };
}

// La fiche à présenter : l'instantané pris à la clôture s'il existe pour ce salarié, sinon le calcul à la volée.
export async function ficheDe(db, { collaborateurId, mois }) {
  const { rows } = await db.query(
    `SELECT c.fiches, c.cree_le, a.prenom, a.nom
     FROM clotures_actuelles c JOIN collaborateurs a ON a.id = c.auteur_id WHERE c.mois = $1 AND c.action = 'cloture'`,
    [`${mois}-01`],
  );
  const figee = rows[0]?.fiches?.find((f) => f.collaborateur.id === collaborateurId);
  if (figee) return { ...figee, figee: { le: rows[0].cree_le.toISOString(), par: `${rows[0].prenom} ${rows[0].nom}` } };
  return { ...(await calculerFiche(db, { collaborateurId, mois })), figee: null };
}

// Un mois se clôture une fois terminé, par un directeur : instantané des fiches de tous les salariés actifs.
export async function cloturerMois(client, { mois, auteurId, aujourdhui, confirmerProvisoire }) {
  const [debut] = bornesDuMois(mois);
  if (debut >= `${aujourdhui.slice(0, 7)}-01`) throw new ErreurMetier(400, "Un mois ne peut être clôturé qu'une fois terminé");
  if (await etatCloture(client, mois)) throw new ErreurMetier(409, 'Ce mois est déjà clôturé');
  const { rows } = await client.query('SELECT id FROM collaborateurs WHERE actif ORDER BY id');
  const fiches = [];
  for (const { id } of rows) fiches.push(await calculerFiche(client, { collaborateurId: Number(id), mois }));
  const enAttente = fiches.filter((f) => f.compteurs.provisoire);
  if (enAttente.length && !confirmerProvisoire) {
    throw new ErreurMetier(409, `${enAttente.length} salarié(s) ont des demandes en attente de décision sur ce mois : confirmez pour clôturer quand même`);
  }
  await client.query(
    `INSERT INTO clotures_mois (mois, action, fiches, auteur_id) VALUES ($1, 'cloture', $2, $3)`,
    [debut, JSON.stringify(fiches), auteurId],
  );
  return fiches.length;
}

export async function rouvrirMois(client, { mois, auteurId }) {
  if (!(await etatCloture(client, mois))) throw new ErreurMetier(409, "Ce mois n'est pas clôturé");
  await client.query(`INSERT INTO clotures_mois (mois, action, auteur_id) VALUES ($1, 'reouverture', $2)`, [`${mois}-01`, auteurId]);
}
