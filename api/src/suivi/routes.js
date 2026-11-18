import { ErreurMetier } from '../erreurs.js';
import { transaction } from '../admin/outils.js';
import { ajouterJours, jourSemaine, nombreDeJours } from '../calendrier/dates.js';
import { ajouterEvenements, cadreDeModification, contexteJours } from './service.js';

const date = { type: 'string', format: 'date' };
const motif = { type: 'string', maxLength: 300 };
const frDate = (iso) => iso.split('-').reverse().join('/');

// Tickets restaurant retirés et jours de télétravail déclarés.
export async function routesSuivi(app, { pool, aujourdhui }) {
  app.addHook('onRequest', app.authentifier);

  // Préparation commune : de qui on parle, ce qu'on a le droit de modifier, et l'état des jours concernés.
  async function preparer(requete, { debut, fin }) {
    const collaborateurId = requete.body.collaborateurId ?? Number(requete.utilisateur.id);
    const cadre = await cadreDeModification(pool, { utilisateur: requete.utilisateur, collaborateurId, aujourdhui: aujourdhui() });
    if (debut < cadre.plusTot || fin > cadre.plusTard) {
      throw new ErreurMetier(
        403,
        cadre.directeur
          ? `Ces dates sortent de la période modifiable (du ${frDate(cadre.plusTot)} au ${frDate(cadre.plusTard)})`
          : `Vous pouvez modifier le mois en cours et les mois à venir (à partir du ${frDate(cadre.plusTot)}) ; au-delà, demandez à un directeur`,
      );
    }
    return { collaborateurId, ...(await contexteJours(pool, { collaborateurId, debut, fin })) };
  }

  const bornes = (jours) => [jours.reduce((a, b) => (a < b ? a : b)), jours.reduce((a, b) => (a > b ? a : b))];
  const SCHEMA_JOURS = { type: 'array', minItems: 1, maxItems: 62, uniqueItems: true, items: date };

  // Retirer (ou rétablir) le ticket restaurant de jours qui y donnent droit.
  app.put('/suivi/tickets', {
    schema: {
      body: {
        type: 'object', required: ['jours', 'retire'], additionalProperties: false,
        properties: { collaborateurId: { type: 'integer', minimum: 1 }, jours: SCHEMA_JOURS, retire: { type: 'boolean' }, motif },
      },
    },
  }, async (requete) => {
    const { jours, retire } = requete.body;
    const texte = requete.body.motif?.trim() || null;
    const [debut, fin] = bornes(jours);
    const contexte = await preparer(requete, { debut, fin });
    const parJour = new Map(contexte.jours.map((j) => [j.jour, j]));
    const sansDroit = retire ? jours.filter((j) => parJour.get(j).ticket === null) : [];
    if (sansDroit.length) {
      throw new ErreurMetier(409, `Pas de ticket restaurant à retirer le ${sansDroit.map(frDate).join(', ')} (jour non travaillé ou absence)`);
    }
    const aChanger = jours.filter((j) => (retire ? parJour.get(j).ticket === 'oui' : parJour.get(j).ticket === 'retire'));
    await transaction(pool, (client) => ajouterEvenements(client, {
      collaborateurId: contexte.collaborateurId, auteurId: Number(requete.utilisateur.id), objet: 'ticket',
      action: retire ? 'retrait' : 'retablissement', jours: aChanger, motif: retire ? texte : null,
    }));
    return { modifies: aChanger.length, inchanges: jours.length - aChanger.length };
  });

  // Déclarer (ou annuler) du télétravail sur des jours précis. Simple déclaration : aucune validation.
  app.put('/suivi/teletravail', {
    schema: {
      body: {
        type: 'object', required: ['jours', 'teletravail'], additionalProperties: false,
        properties: { collaborateurId: { type: 'integer', minimum: 1 }, jours: SCHEMA_JOURS, teletravail: { type: 'boolean' }, motif },
      },
    },
  }, async (requete) => {
    const { jours, teletravail } = requete.body;
    const [debut, fin] = bornes(jours);
    const contexte = await preparer(requete, { debut, fin });
    const parJour = new Map(contexte.jours.map((j) => [j.jour, j]));
    if (teletravail) {
      const impossibles = jours.filter((j) => { const x = parJour.get(j); return !x.ouvre || (x.matin && x.apresMidi); });
      if (impossibles.length) {
        throw new ErreurMetier(409, `Télétravail impossible le ${impossibles.map(frDate).join(', ')} (jour non travaillé ou absence)`);
      }
    }
    const aChanger = jours.filter((j) => contexte.declares.has(j) !== teletravail);
    await transaction(pool, (client) => ajouterEvenements(client, {
      collaborateurId: contexte.collaborateurId, auteurId: Number(requete.utilisateur.id), objet: 'teletravail',
      action: teletravail ? 'declaration' : 'annulation', jours: aChanger, motif: requete.body.motif?.trim() || null,
    }));
    return { modifies: aChanger.length, inchanges: jours.length - aChanger.length };
  });

  // Préremplissage : « en télétravail tous les mardis jusqu'au … ». Les jours qui ne s'y prêtent pas sont écartés et
  // comptés dans la réponse ; chaque jour reste ensuite modifiable à l'unité.
  app.post('/suivi/teletravail/serie', {
    schema: {
      body: {
        type: 'object', required: ['joursSemaine', 'debut', 'fin'], additionalProperties: false,
        properties: {
          collaborateurId: { type: 'integer', minimum: 1 },
          joursSemaine: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 5 } },
          debut: date, fin: date,
          teletravail: { type: 'boolean', default: true },
        },
      },
    },
  }, async (requete) => {
    const { joursSemaine, debut, fin, teletravail } = requete.body;
    if (fin < debut) throw new ErreurMetier(400, 'La date de fin précède la date de début');
    if (nombreDeJours(debut, fin) > 366) throw new ErreurMetier(400, 'La série est limitée à 366 jours');
    // Un collaborateur dont la série démarre avant le mois en cours : on commence au mois en cours, et on le dit.
    const collaborateurId = requete.body.collaborateurId ?? Number(requete.utilisateur.id);
    const cadre = await cadreDeModification(pool, { utilisateur: requete.utilisateur, collaborateurId, aujourdhui: aujourdhui() });
    const debutEffectif = debut < cadre.plusTot ? cadre.plusTot : debut;
    if (fin > cadre.plusTard) throw new ErreurMetier(403, `La série ne peut pas dépasser le ${frDate(cadre.plusTard)}`);
    if (fin < debutEffectif) throw new ErreurMetier(403, `Les jours antérieurs au ${frDate(cadre.plusTot)} ne sont modifiables que par un directeur`);

    const contexte = await contexteJours(pool, { collaborateurId, debut: debutEffectif, fin });
    const ecartes = { nonTravailles: 0, absence: 0, dejaFait: 0 };
    const aChanger = [];
    for (const j of contexte.jours) {
      if (!joursSemaine.includes(jourSemaine(j.jour))) continue;
      if (teletravail && !j.ouvre) { ecartes.nonTravailles++; continue; }
      if (teletravail && j.matin && j.apresMidi) { ecartes.absence++; continue; }
      if (contexte.declares.has(j.jour) === teletravail) { ecartes.dejaFait++; continue; }
      aChanger.push(j.jour);
    }
    const noms = ['', 'lundis', 'mardis', 'mercredis', 'jeudis', 'vendredis'];
    await transaction(pool, (client) => ajouterEvenements(client, {
      collaborateurId, auteurId: Number(requete.utilisateur.id), objet: 'teletravail',
      action: teletravail ? 'declaration' : 'annulation', jours: aChanger,
      motif: `Série : ${[...joursSemaine].sort().map((n) => noms[n]).join(', ')} du ${frDate(debutEffectif)} au ${frDate(fin)}`,
    }));
    return { modifies: aChanger.length, ecartes, debutEffectif, debutDemande: debut };
  });
}
