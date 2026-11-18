import { empreinte, nouveauJeton } from './jetons.js';

export const COOKIE_SESSION = 'absences_session';

// Chemin public de l'application d'après APP_URL, sans barre finale : « /abs », ou « » à la racine.
export function cheminPublic(appUrl) {
  try { return new URL(appUrl).pathname.replace(/\/+$/, ''); } catch { return ''; }
}

export function creerSessions({ pool, config }) {
  // Le cookie n'est envoyé que sous le chemin de l'application (utile quand elle est publiée sous un préfixe, comme /abs).
  const optionsCookie = { path: cheminPublic(config.appUrl) || '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure };

  return {
    async ouvrir(reponse, collaborateurId) {
      const jeton = nouveauJeton();
      await pool.query(
        `INSERT INTO sessions (jeton_hash, collaborateur_id, expire_le)
         VALUES ($1, $2, now() + make_interval(hours => $3))`,
        [empreinte(jeton), collaborateurId, config.sessionDureeHeures],
      );
      // Ménage des sessions expirées, au fil des connexions.
      await pool.query('DELETE FROM sessions WHERE expire_le < now()');
      reponse.setCookie(COOKIE_SESSION, jeton, { ...optionsCookie, maxAge: config.sessionDureeHeures * 3600 });
    },

    // Renvoie le collaborateur de la session, ou null si elle est absente, expirée ou si le compte est désactivé.
    async lire(requete) {
      const jeton = requete.cookies[COOKIE_SESSION];
      if (!jeton) return null;
      const { rows } = await pool.query(
        `SELECT c.id, c.email, c.nom, c.prenom, c.role, c.equipe_id, e.nom AS equipe_nom,
                c.mot_de_passe_hash IS NOT NULL AS a_mot_de_passe
         FROM sessions s
         JOIN collaborateurs c ON c.id = s.collaborateur_id
         JOIN equipes e ON e.id = c.equipe_id
         WHERE s.jeton_hash = $1 AND s.expire_le > now() AND c.actif`,
        [empreinte(jeton)],
      );
      return rows[0] ?? null;
    },

    async fermer(requete, reponse) {
      const jeton = requete.cookies[COOKIE_SESSION];
      if (jeton) await pool.query('DELETE FROM sessions WHERE jeton_hash = $1', [empreinte(jeton)]);
      reponse.clearCookie(COOKIE_SESSION, optionsCookie);
    },
  };
}
