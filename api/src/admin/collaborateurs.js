import { ErreurMetier, introuvable } from '../erreurs.js';
import { creerLienMotDePasse } from '../auth/jetons.js';
import { champsModifies, parametresId, transaction, trier } from './outils.js';

const DUREE_INVITATION_HEURES = 72;

const LISTE = `
  SELECT id, email, nom, prenom, equipe_id, role, actif,
         mot_de_passe_hash IS NOT NULL AS a_mot_de_passe,
         microsoft_oid IS NOT NULL AS a_microsoft
  FROM collaborateurs`;

const versJson = (c) => ({
  id: Number(c.id),
  email: c.email,
  nom: c.nom,
  prenom: c.prenom,
  equipeId: Number(c.equipe_id),
  role: c.role,
  actif: c.actif,
  aMotDePasse: c.a_mot_de_passe,
  aMicrosoft: c.a_microsoft,
});

const texte = { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' };
const proprietes = {
  email: { type: 'string', maxLength: 320, pattern: '^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$' },
  nom: texte,
  prenom: texte,
  equipeId: { type: 'integer', minimum: 1 },
  role: { enum: ['collaborateur', 'responsable', 'directeur'] },
};

export async function routesCollaborateurs(app, { pool, config, courriel }) {
  const lire = async (client, id) => {
    const { rows } = await client.query(`${LISTE} WHERE id = $1`, [id]);
    if (!rows.length) throw introuvable('Collaborateur');
    return versJson(rows[0]);
  };

  async function verifierEquipe(client, equipeId) {
    const { rows } = await client.query('SELECT actif FROM equipes WHERE id = $1', [equipeId]);
    if (!rows.length) throw new ErreurMetier(400, 'Équipe inconnue');
    if (!rows[0].actif) throw new ErreurMetier(400, 'Cette équipe est désactivée');
  }

  // Envoie le lien qui permet de choisir son mot de passe. Renvoie false si l'e-mail n'a pas pu partir.
  async function inviter(compte, log) {
    try {
      const lien = await creerLienMotDePasse(pool, {
        collaborateurId: compte.id, dureeHeures: DUREE_INVITATION_HEURES, appUrl: config.appUrl,
      });
      await courriel.envoyer({
        a: compte.email,
        sujet: 'Gestion des absences : votre accès',
        texte: [
          `Bonjour ${compte.prenom},`,
          '',
          "Un accès à l'outil de gestion des absences a été créé pour vous.",
          'Pour choisir votre mot de passe, ouvrez ce lien :',
          lien,
          '',
          `Il est valable ${DUREE_INVITATION_HEURES} heures et ne peut servir qu'une fois.`,
          `Vous pourrez ensuite vous connecter sur ${config.appUrl}`,
        ].join('\n'),
      });
      return true;
    } catch (erreur) {
      log.error(erreur, "envoi de l'invitation impossible");
      return false;
    }
  }

  app.get('/collaborateurs', async () => {
    const { rows } = await pool.query(LISTE);
    return trier(rows.map(versJson), (c) => `${c.nom} ${c.prenom}`);
  });

  app.post('/collaborateurs', {
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['email', 'nom', 'prenom', 'equipeId'],
        properties: { ...proprietes, inviter: { type: 'boolean' } },
      },
    },
  }, async (requete, reponse) => {
    const { email, nom, prenom, equipeId, role = 'collaborateur', inviter: avecInvitation = false } = requete.body;
    const cree = await transaction(pool, async (client) => {
      await verifierEquipe(client, equipeId);
      const { rows } = await client.query(
        'INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [email.trim(), nom.trim(), prenom.trim(), equipeId, role],
      );
      return lire(client, rows[0].id);
    });
    const invitationEnvoyee = avecInvitation ? await inviter(cree, requete.log) : undefined;
    return reponse.code(201).send({ ...cree, invitationEnvoyee });
  });

  app.patch('/collaborateurs/:id', {
    schema: {
      params: parametresId,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { ...proprietes, actif: { type: 'boolean' } },
      },
    },
  }, async (requete) => {
    const { id } = requete.params;
    const corps = { ...requete.body };
    for (const champ of ['email', 'nom', 'prenom']) if (corps[champ] !== undefined) corps[champ] = corps[champ].trim();

    return transaction(pool, async (client) => {
      const { rows } = await client.query('SELECT role, actif FROM collaborateurs WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw introuvable('Collaborateur');
      const role = corps.role ?? rows[0].role;
      const actif = corps.actif ?? rows[0].actif;

      // Garde-fou : il reste toujours au moins un directeur actif, celui qui fait la modification.
      if (Number(requete.utilisateur.id) === id && (!actif || role !== 'directeur')) {
        throw new ErreurMetier(409, 'Vous ne pouvez pas vous désactiver ni changer votre propre rôle');
      }
      if (corps.equipeId !== undefined) await verifierEquipe(client, corps.equipeId);

      const peutValider = actif && ['responsable', 'directeur'].includes(role);
      if (!peutValider) {
        const equipes = await client.query('SELECT nom FROM equipes WHERE responsable_id = $1 ORDER BY lower(nom)', [id]);
        if (equipes.rowCount) {
          const noms = equipes.rows.map((e) => `« ${e.nom} »`).join(', ');
          throw new ErreurMetier(409, `Ce collaborateur est responsable de ${noms} : désignez d'abord un autre responsable`);
        }
        await client.query('DELETE FROM delegations WHERE delegue_id = $1', [id]);
      }
      if (!actif) await client.query('DELETE FROM sessions WHERE collaborateur_id = $1', [id]);

      const { colonnes, valeurs } = champsModifies(corps, {
        email: 'email', nom: 'nom', prenom: 'prenom', equipeId: 'equipe_id', role: 'role', actif: 'actif',
      });
      await client.query(
        `UPDATE collaborateurs SET ${colonnes.join(', ')} WHERE id = $${valeurs.length + 1}`,
        [...valeurs, id],
      );
      return lire(client, id);
    });
  });

  // (Ré)envoie le lien de choix du mot de passe.
  app.post('/collaborateurs/:id/invitation', { schema: { params: parametresId } }, async (requete, reponse) => {
    const compte = await lire(pool, requete.params.id);
    if (!compte.actif) throw new ErreurMetier(409, 'Ce collaborateur est désactivé');
    if (!(await inviter(compte, requete.log))) throw new ErreurMetier(502, "L'e-mail n'a pas pu être envoyé");
    return reponse.code(204).send();
  });
}
