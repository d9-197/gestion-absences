import { creerLienMotDePasse, empreinte } from './jetons.js';
import { hacher, verifier, LONGUEUR_MINIMALE } from './mots-de-passe.js';

const COOKIE_OIDC = 'absences_oidc';
const DUREE_JETON_OUBLI_HEURES = 1;

const profil = (u) => ({
  id: Number(u.id),
  email: u.email,
  nom: u.nom,
  prenom: u.prenom,
  role: u.role,
  equipe: { id: Number(u.equipe_id), nom: u.equipe_nom },
});

export async function routesAuth(app, { pool, config, sessions, courriel, microsoft, limites }) {
  // Vérifié même quand le compte n'existe pas, pour que le temps de réponse ne révèle rien.
  const hachageFactice = await hacher('compte inexistant');
  const cookieOidc = { path: '/api/auth/microsoft', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure };

  app.get('/api/auth/config', async () => ({ microsoft: Boolean(microsoft) }));

  app.get('/api/auth/moi', { preHandler: app.authentifier }, async (requete) => profil(requete.utilisateur));

  app.post('/api/auth/connexion', {
    config: { rateLimit: limites.connexion },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'motDePasse'],
        properties: {
          email: { type: 'string', minLength: 1, maxLength: 320 },
          motDePasse: { type: 'string', minLength: 1, maxLength: 1024 },
        },
      },
    },
  }, async (requete, reponse) => {
    const { email, motDePasse } = requete.body;
    const { rows } = await pool.query(
      'SELECT id, mot_de_passe_hash FROM collaborateurs WHERE lower(email) = lower($1) AND actif',
      [email.trim()],
    );
    const compte = rows[0];
    const correct = await verifier(motDePasse, compte?.mot_de_passe_hash ?? hachageFactice);
    if (!compte?.mot_de_passe_hash || !correct) {
      return reponse.code(401).send({ erreur: 'E-mail ou mot de passe incorrect' });
    }
    await sessions.ouvrir(reponse, compte.id);
    return reponse.code(204).send();
  });

  app.post('/api/auth/deconnexion', async (requete, reponse) => {
    await sessions.fermer(requete, reponse);
    return reponse.code(204).send();
  });

  // Répond toujours de la même façon, que le compte existe ou non.
  app.post('/api/auth/mot-de-passe/oubli', {
    config: { rateLimit: limites.oubli },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', minLength: 1, maxLength: 320 } },
      },
    },
  }, async (requete, reponse) => {
    const { rows } = await pool.query(
      'SELECT id, email, prenom FROM collaborateurs WHERE lower(email) = lower($1) AND actif',
      [requete.body.email.trim()],
    );
    const compte = rows[0];
    if (compte) {
      try {
        const lien = await creerLienMotDePasse(pool, {
          collaborateurId: compte.id, dureeHeures: DUREE_JETON_OUBLI_HEURES, appUrl: config.appUrl,
        });
        await courriel.envoyer({
          a: compte.email,
          sujet: 'Gestion des absences : définir votre mot de passe',
          texte: [
            `Bonjour ${compte.prenom},`,
            '',
            'Pour définir votre mot de passe, ouvrez ce lien :',
            lien,
            '',
            `Il est valable ${DUREE_JETON_OUBLI_HEURES} heure et ne peut servir qu'une fois.`,
            "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
          ].join('\n'),
        });
      } catch (erreur) {
        requete.log.error(erreur, "envoi de l'e-mail de mot de passe impossible");
      }
    }
    return reponse.code(204).send();
  });

  app.post('/api/auth/mot-de-passe/definir', {
    config: { rateLimit: limites.oubli },
    schema: {
      body: {
        type: 'object',
        required: ['jeton', 'motDePasse'],
        properties: {
          jeton: { type: 'string', minLength: 1, maxLength: 200 },
          motDePasse: { type: 'string', minLength: LONGUEUR_MINIMALE, maxLength: 1024 },
        },
      },
    },
  }, async (requete, reponse) => {
    const hachage = await hacher(requete.body.motDePasse);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const jeton = await client.query(
        `UPDATE jetons_mot_de_passe SET utilise_le = now()
         WHERE jeton_hash = $1 AND utilise_le IS NULL AND expire_le > now()
         RETURNING collaborateur_id`,
        [empreinte(requete.body.jeton)],
      );
      const compte = jeton.rowCount
        ? await client.query(
          'UPDATE collaborateurs SET mot_de_passe_hash = $1 WHERE id = $2 AND actif RETURNING id',
          [hachage, jeton.rows[0].collaborateur_id],
        )
        : { rowCount: 0 };
      if (!compte.rowCount) {
        await client.query('ROLLBACK');
        return reponse.code(400).send({ erreur: 'Ce lien est invalide ou a expiré' });
      }
      // Un changement de mot de passe ferme les sessions ouvertes et annule les autres liens.
      await client.query('DELETE FROM sessions WHERE collaborateur_id = $1', [compte.rows[0].id]);
      await client.query(
        'UPDATE jetons_mot_de_passe SET utilise_le = now() WHERE collaborateur_id = $1 AND utilise_le IS NULL',
        [compte.rows[0].id],
      );
      await client.query('COMMIT');
      return reponse.code(204).send();
    } catch (erreur) {
      await client.query('ROLLBACK');
      throw erreur;
    } finally {
      client.release();
    }
  });

  // --- Connexion Microsoft -------------------------------------------------

  app.get('/api/auth/microsoft', { config: { rateLimit: limites.connexion } }, async (requete, reponse) => {
    if (!microsoft) return reponse.code(404).send({ erreur: 'Connexion Microsoft non configurée' });
    try {
      const { url, verifications } = await microsoft.preparer();
      reponse.setCookie(COOKIE_OIDC, JSON.stringify(verifications), { ...cookieOidc, maxAge: 600 });
      return reponse.redirect(url);
    } catch (erreur) {
      requete.log.error(erreur, 'préparation de la connexion Microsoft impossible');
      return reponse.redirect('/connexion?erreur=microsoft');
    }
  });

  app.get('/api/auth/microsoft/retour', async (requete, reponse) => {
    if (!microsoft) return reponse.code(404).send({ erreur: 'Connexion Microsoft non configurée' });
    const brut = requete.cookies[COOKIE_OIDC];
    reponse.clearCookie(COOKIE_OIDC, cookieOidc);

    let identite;
    try {
      identite = await microsoft.terminer(requete.url, JSON.parse(brut));
    } catch (erreur) {
      requete.log.warn(erreur, 'retour de connexion Microsoft refusé');
      return reponse.redirect('/connexion?erreur=microsoft');
    }

    // Compte déjà lié à cette identité Microsoft, sinon premier rattachement par l'adresse e-mail.
    let { rows } = await pool.query('SELECT id FROM collaborateurs WHERE microsoft_oid = $1 AND actif', [identite.oid]);
    if (!rows.length && identite.emails.length) {
      ({ rows } = await pool.query(
        `UPDATE collaborateurs SET microsoft_oid = $1
         WHERE id = (
           SELECT id FROM collaborateurs
           WHERE lower(email) = ANY($2) AND actif AND microsoft_oid IS NULL
           LIMIT 1
         )
         RETURNING id`,
        [identite.oid, identite.emails.map((email) => email.toLowerCase())],
      ));
    }
    if (!rows.length) return reponse.redirect('/connexion?erreur=compte-inconnu');

    await sessions.ouvrir(reponse, rows[0].id);
    return reponse.redirect('/');
  });
}
