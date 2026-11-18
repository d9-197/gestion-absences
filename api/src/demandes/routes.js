import { ErreurMetier, introuvable } from '../erreurs.js';
import { transaction, parametresId } from '../admin/outils.js';
import { enfiler } from '../emails/file.js';
import {
  SELECTION_DEMANDE, demandeVersJson, enregistrerDemande, lireDemande, lireDemandeVisible, preparerDemande,
} from './service.js';

const date = { type: 'string', format: 'date' };
const demiJournee = { enum: ['matin', 'apres_midi'] };
const STATUTS = ['en_attente', 'approuvee', 'refusee', 'enregistree', 'retiree', 'annulee'];

const corpsDemande = {
  type: 'object',
  required: ['typeId', 'dateDebut', 'dateFin'],
  additionalProperties: false,
  properties: {
    collaborateurId: { type: 'integer', minimum: 1 },
    typeId: { type: 'integer', minimum: 1 },
    dateDebut: date,
    debutDemiJournee: demiJournee,
    dateFin: date,
    finDemiJournee: demiJournee,
    commentaire: { type: 'string', maxLength: 1000 },
  },
};

// L'aperçu d'une modification peut préciser la demande remplacée, pour ne pas la compter comme un chevauchement.
const corpsApercu = { ...corpsDemande, properties: { ...corpsDemande.properties, remplaceId: { type: 'integer', minimum: 1 } } };

// Corps d'une modification : celui d'une demande, sans le collaborateur, qui ne change pas.
const { collaborateurId: _collaborateur, ...proprietesModification } = corpsDemande.properties;
const corpsModification = { ...corpsDemande, properties: proprietesModification };

// Une règle de la base (déclencheur) refuse un enchaînement impossible : la demande a changé entre-temps.
const dejaTraitee = (erreur) => {
  if (erreur.code === '23514') throw new ErreurMetier(409, 'Cette demande a déjà été traitée ou retirée');
  throw erreur;
};

export async function routesDemandes(app, { pool, aujourdhui }) {
  app.addHook('onRequest', app.authentifier);
  const moiDe = (requete) => Number(requete.utilisateur.id);

  // --- Consultation ----------------------------------------------------------

  // mes : les demandes dont je suis le collaborateur ; gerees : celles que je peux traiter.
  app.get('/demandes', {
    schema: {
      querystring: {
        type: 'object',
        properties: { portee: { enum: ['mes', 'gerees'] }, statut: { enum: STATUTS } },
      },
    },
  }, async (requete) => {
    const moi = moiDe(requete);
    const { portee = 'mes', statut } = requete.query;
    const filtres = [portee === 'mes' ? 'd.collaborateur_id = $1' : 'EXISTS (SELECT 1 FROM valideurs_de(d.collaborateur_id) v WHERE v = $1)'];
    const valeurs = [moi];
    if (statut) {
      valeurs.push(statut);
      filtres.push(`d.statut = $${valeurs.length}`);
    }
    const { rows } = await pool.query(
      `${SELECTION_DEMANDE} WHERE ${filtres.join(' AND ')} ORDER BY d.date_debut DESC, d.id DESC LIMIT 500`,
      valeurs,
    );
    return rows.map((d) => demandeVersJson(d, moi));
  });

  app.get('/demandes/compteur', async (requete) => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM demandes_avec_statut d
       WHERE d.statut = 'en_attente' AND EXISTS (SELECT 1 FROM valideurs_de(d.collaborateur_id) v WHERE v = $1)`,
      [moiDe(requete)],
    );
    return { aTraiter: rows[0].n };
  });

  // Types proposés à la saisie : les types actifs, pour tous les rôles.
  app.get('/demandes/types', async () => {
    const { rows } = await pool.query(
      `SELECT id, libelle, approbation_requise, delai_prevenance_jours
       FROM types_absence WHERE actif ORDER BY ordre, lower(libelle)`,
    );
    return rows.map((t) => ({
      id: Number(t.id), libelle: t.libelle, approbationRequise: t.approbation_requise, delaiPrevenanceJours: t.delai_prevenance_jours,
    }));
  });

  // Les personnes pour lesquelles je peux saisir une absence : moi et celles que je peux valider.
  app.get('/demandes/collaborateurs', async (requete) => {
    const moi = moiDe(requete);
    const { rows } = await pool.query(
      `SELECT c.id, c.prenom, c.nom FROM collaborateurs c
       WHERE c.actif AND (c.id = $1 OR EXISTS (SELECT 1 FROM valideurs_de(c.id) v WHERE v = $1))
       ORDER BY (c.id = $1) DESC, lower(c.nom), lower(c.prenom)`,
      [moi],
    );
    return rows.map((c) => ({ id: Number(c.id), prenom: c.prenom, nom: c.nom, moi: Number(c.id) === moi }));
  });

  app.get('/demandes/:id', { schema: { params: parametresId } }, async (requete) => {
    const moi = moiDe(requete);
    const demande = await lireDemandeVisible(pool, requete.params.id, moi);
    const journal = await pool.query(
      `SELECT ev.id, ev.type, ev.motif, ev.cree_le, a.id AS auteur_id, a.prenom, a.nom
       FROM evenements_demande ev JOIN collaborateurs a ON a.id = ev.auteur_id
       WHERE ev.demande_id = $1 ORDER BY ev.id`,
      [requete.params.id],
    );
    return {
      ...demandeVersJson(demande, moi),
      journal: journal.rows.map((e) => ({
        id: Number(e.id), type: e.type, motif: e.motif, le: e.cree_le,
        auteur: { id: Number(e.auteur_id), prenom: e.prenom, nom: e.nom },
      })),
    };
  });

  // --- Saisie ----------------------------------------------------------------

  // Ce que donnerait la soumission : durée, avertissements, circuit. N'enregistre rien.
  app.post('/demandes/previsualisation', { schema: { body: corpsApercu } }, async (requete) => {
    const { remplaceId, ...corps } = requete.body;
    const prepare = await preparerDemande(pool, { utilisateur: requete.utilisateur, corps, aujourdhui: aujourdhui(), ignorer: remplaceId ?? null });
    return {
      dureeDemiJournees: prepare.duree,
      avertissements: prepare.avertissements,
      approbationRequise: prepare.type.approbationRequise,
      // Qui sera prévenu et examinera la demande (vide pour une simple déclaration).
      valideurs: prepare.type.approbationRequise ? prepare.valideursProches : [],
      blocage: prepare.blocage,
    };
  });

  app.post('/demandes', { schema: { body: corpsDemande } }, async (requete, reponse) => {
    const moi = moiDe(requete);
    const prepare = await preparerDemande(pool, { utilisateur: requete.utilisateur, corps: requete.body, aujourdhui: aujourdhui() });
    if (prepare.blocage) throw new ErreurMetier(409, prepare.blocage);
    const id = await transaction(pool, (client) =>
      enregistrerDemande(client, { prepare, auteurId: moi, commentaire: requete.body.commentaire }));
    app.fileEmails.reveiller();
    return reponse.code(201).send(demandeVersJson(await lireDemande(pool, id, moi), moi));
  });

  // --- Circuit ---------------------------------------------------------------

  app.post('/demandes/:id/decision', {
    schema: {
      params: parametresId,
      body: {
        type: 'object', required: ['decision'], additionalProperties: false,
        properties: { decision: { enum: ['approbation', 'refus'] }, motif: { type: 'string', maxLength: 1000 } },
      },
    },
  }, async (requete) => {
    const moi = moiDe(requete);
    const { decision } = requete.body;
    const motif = requete.body.motif?.trim() || null;
    if (decision === 'refus' && !motif) throw new ErreurMetier(400, 'Le motif est obligatoire en cas de refus');

    const demande = await lireDemandeVisible(pool, requete.params.id, moi);
    if (!demande.est_valideur) throw new ErreurMetier(403, "Vous ne pouvez pas traiter cette demande");
    if (demande.statut !== 'en_attente') throw new ErreurMetier(409, 'Cette demande a déjà été traitée ou retirée');

    try {
      await transaction(pool, async (client) => {
        const evenement = await client.query(
          'INSERT INTO evenements_demande (demande_id, type, auteur_id, motif) VALUES ($1, $2, $3, $4) RETURNING id',
          [demande.id, decision, moi, decision === 'refus' ? motif : null],
        );
        await enfiler(client, evenement.rows[0].id);
      });
    } catch (erreur) {
      dejaTraitee(erreur);
    }
    app.fileEmails.reveiller();
    return demandeVersJson(await lireDemande(pool, demande.id, moi), moi);
  });

  // Une demande encore en attente est retirée par son collaborateur ou par la personne qui l'a saisie, sans validation.
  app.post('/demandes/:id/retrait', { schema: { params: parametresId } }, async (requete) => {
    const moi = moiDe(requete);
    const demande = await lireDemandeVisible(pool, requete.params.id, moi);
    if (Number(demande.collaborateur_id) !== moi && Number(demande.saisie_par_id) !== moi) {
      throw new ErreurMetier(403, "Seul l'auteur de la demande peut la retirer");
    }
    if (demande.statut !== 'en_attente') throw new ErreurMetier(409, 'Seule une demande en attente peut être retirée');
    try {
      await pool.query(
        `INSERT INTO evenements_demande (demande_id, type, auteur_id) VALUES ($1, 'retrait', $2)`,
        [demande.id, moi],
      );
    } catch (erreur) {
      dejaTraitee(erreur);
    }
    return demandeVersJson(await lireDemande(pool, demande.id, moi), moi);
  });

  // « Modifier » une demande en attente : elle est retirée et remplacée par une nouvelle, dans une même transaction.
  // Les deux restent dans l'historique, la nouvelle portant la référence de l'ancienne.
  app.post('/demandes/:id/modification', { schema: { params: parametresId, body: corpsModification } }, async (requete, reponse) => {
    const moi = moiDe(requete);
    const origine = await lireDemandeVisible(pool, requete.params.id, moi);
    if (Number(origine.collaborateur_id) !== moi && Number(origine.saisie_par_id) !== moi) {
      throw new ErreurMetier(403, "Seul l'auteur de la demande peut la modifier");
    }
    if (origine.nature !== 'absence') throw new ErreurMetier(409, "Une demande d'annulation ne se modifie pas");
    if (origine.statut !== 'en_attente') throw new ErreurMetier(409, 'Seule une demande en attente peut être modifiée');

    const prepare = await preparerDemande(pool, {
      utilisateur: requete.utilisateur,
      corps: { ...requete.body, collaborateurId: Number(origine.collaborateur_id) },
      aujourdhui: aujourdhui(),
      ignorer: Number(origine.id),
    });
    if (prepare.blocage) throw new ErreurMetier(409, prepare.blocage);

    let id;
    try {
      id = await transaction(pool, async (client) => {
        const nouvelle = await enregistrerDemande(client, {
          prepare, auteurId: moi, commentaire: requete.body.commentaire, remplaceId: Number(origine.id),
        });
        await client.query(
          `INSERT INTO evenements_demande (demande_id, type, auteur_id, motif) VALUES ($1, 'retrait', $2, $3)`,
          [origine.id, moi, `Remplacée par la demande n° ${nouvelle}`],
        );
        return nouvelle;
      });
    } catch (erreur) {
      dejaTraitee(erreur);
    }
    app.fileEmails.reveiller();
    return reponse.code(201).send(demandeVersJson(await lireDemande(pool, id, moi), moi));
  });

  // Une demande approuvée ne se modifie pas : on en crée une d'annulation, validée par le même circuit.
  app.post('/demandes/:id/annulation', {
    schema: {
      params: parametresId,
      body: { type: 'object', additionalProperties: false, properties: { commentaire: { type: 'string', maxLength: 1000 } } },
    },
  }, async (requete, reponse) => {
    const moi = moiDe(requete);
    const origine = await lireDemandeVisible(pool, requete.params.id, moi);
    const { annuler } = demandeVersJson(origine, moi).actions;
    if (!annuler) {
      if (origine.nature !== 'absence') throw new ErreurMetier(409, "Une demande d'annulation ne peut pas être annulée");
      if (origine.annulation_en_cours) throw new ErreurMetier(409, "Une demande d'annulation est déjà en cours");
      if (!['approuvee', 'enregistree'].includes(origine.statut)) {
        throw new ErreurMetier(409, 'Seule une absence approuvée ou enregistrée peut être annulée');
      }
      throw new ErreurMetier(403, 'Vous ne pouvez pas annuler cette absence');
    }

    // L'annulation reprend la période de l'absence d'origine, avec les mêmes calculs que toute demande.
    const prepare = await preparerDemande(pool, {
      utilisateur: requete.utilisateur,
      corps: {
        collaborateurId: Number(origine.collaborateur_id), typeId: Number(origine.type_id),
        dateDebut: origine.date_debut, debutDemiJournee: origine.debut_demi_journee,
        dateFin: origine.date_fin, finDemiJournee: origine.fin_demi_journee,
      },
      aujourdhui: aujourdhui(),
      pourAnnulation: true,
    });
    if (prepare.blocage) throw new ErreurMetier(409, prepare.blocage);
    // L'absence d'origine occupe déjà la période : ce chevauchement n'est pas un avertissement utile.
    prepare.avertissements = [];
    const id = await transaction(pool, (client) => enregistrerDemande(client, {
      prepare, auteurId: moi, commentaire: requete.body.commentaire, nature: 'annulation', demandeAnnuleeId: origine.id,
    }));
    app.fileEmails.reveiller();
    return reponse.code(201).send(demandeVersJson(await lireDemande(pool, id, moi), moi));
  });
}
