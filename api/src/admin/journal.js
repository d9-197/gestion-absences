// Journal des modifications d'administration : qui a changé quoi, et quand.
// Chaque requête qui modifie quelque chose sous /api/admin et réussit laisse une ligne, ajoutée juste après la
// modification : si l'écriture du journal échoue, la modification reste faite et l'erreur est consignée dans les logs du serveur.

const ACTIONS = {
  'POST /collaborateurs': 'Création d\'un collaborateur',
  'PATCH /collaborateurs/:id': 'Modification d\'un collaborateur',
  'POST /collaborateurs/:id/invitation': 'Envoi d\'un lien de mot de passe',
  'POST /collaborateurs/import': 'Import de collaborateurs',
  'POST /equipes': 'Création d\'une équipe',
  'PATCH /equipes/:id': 'Modification d\'une équipe',
  'PUT /equipes/:id/delegues': 'Délégations d\'une équipe',
  'DELETE /equipes/:id': 'Suppression d\'une équipe',
  'POST /types-absence': 'Création d\'un type d\'absence',
  'PATCH /types-absence/:id': 'Modification d\'un type d\'absence',
  'DELETE /types-absence/:id': 'Suppression d\'un type d\'absence',
  'POST /jours-feries': 'Ajout d\'un jour férié',
  'PATCH /jours-feries/:jour': 'Modification d\'un jour férié',
  'DELETE /jours-feries/:jour': 'Suppression d\'un jour férié',
  'POST /jours-feries/retablir': 'Rétablissement des jours fériés',
  'POST /jours-imposes': 'Ajout d\'un jour imposé',
  'POST /jours-imposes/plage': 'Ajout de jours imposés sur une période',
  'POST /jours-imposes/copie': 'Copie de jours imposés d\'une année sur l\'autre',
  'PATCH /jours-imposes/:id': 'Modification d\'un jour imposé',
  'DELETE /jours-imposes/:id': 'Suppression d\'un jour imposé',
  'PUT /conservation': 'Durée de conservation',
  'PUT /parametres-pdf': 'Paramètres du PDF',
  'PUT /notifications': 'Réglage des notifications',
  'POST /envois-email/relancer': 'Relance des e-mails en échec',
  'POST /envois-email/:id/relancer': 'Relance d\'un e-mail',
};

// Cible lisible d'une modification, d'après la ressource et son identifiant.
const CIBLES = {
  collaborateurs: `SELECT prenom || ' ' || nom || ' (' || email || ')' AS c FROM collaborateurs WHERE id = $1`,
  equipes: 'SELECT nom AS c FROM equipes WHERE id = $1',
  'types-absence': 'SELECT libelle AS c FROM types_absence WHERE id = $1',
  'jours-imposes': `SELECT libelle || ' (' || jour || ')' AS c FROM jours_imposes WHERE id = $1`,
};

// Les valeurs saisies sont conservées telles quelles, sauf si le nom du champ évoque un secret.
const SECRET = /mot_?de_?passe|secret|jeton|token/i;
const nettoyer = (corps) => (corps && typeof corps === 'object' && !Array.isArray(corps)
  ? Object.fromEntries(Object.entries(corps).map(([cle, valeur]) => [
    cle,
    SECRET.test(cle) ? '(masqué)' : cle === 'csv' ? `(fichier de ${String(valeur).length} caractères)` : valeur,
  ]))
  : corps ?? null);

export function journaliser(app, pool) {
  app.addHook('preHandler', async (requete) => {
    if (requete.method === 'GET') return;
    const [, ressource] = requete.routeOptions.url.replace(/^\/api\/admin/, '').split('/');
    const id = requete.params?.id;
    if (CIBLES[ressource] && id) {
      requete.cibleJournal = (await pool.query(CIBLES[ressource], [id]).catch(() => ({ rows: [] }))).rows[0]?.c ?? `n° ${id}`;
    } else if (requete.params?.jour) {
      requete.cibleJournal = requete.params.jour;
    }
  });

  // La ligne est écrite avant l'envoi de la réponse : quand l'interface reçoit « fait », le journal est déjà à jour.
  // La réponse d'une création donne en outre le nom de ce qui vient d'être créé.
  app.addHook('onSend', async (requete, reponse, charge) => {
    if (requete.method === 'GET' || reponse.statusCode >= 400 || !requete.utilisateur) return charge;
    if (requete.method === 'POST' && typeof charge === 'string') {
      try {
        const objet = JSON.parse(charge);
        const nom = objet.nom !== undefined ? `${objet.prenom ? `${objet.prenom} ` : ''}${objet.nom}` : objet.libelle;
        if (nom) requete.cibleJournal ??= objet.email ? `${nom} (${objet.email})` : nom;
      } catch { /* réponse sans JSON : pas de cible */ }
    }
    const route = requete.routeOptions.url.replace(/^\/api\/admin/, '');
    try {
      await pool.query(
        `INSERT INTO journal_admin (auteur_id, auteur_nom, action, cible, details) VALUES ($1, $2, $3, $4, $5)`,
        [
          requete.utilisateur.id, `${requete.utilisateur.prenom} ${requete.utilisateur.nom}`,
          ACTIONS[`${requete.method} ${route}`] ?? `${requete.method} ${route}`, requete.cibleJournal ?? null,
          JSON.stringify({ parametres: nettoyer(requete.params), corps: nettoyer(requete.body) }),
        ],
      );
    } catch (erreur) {
      requete.log.error(erreur, "journal d'administration : écriture impossible");
    }
    return charge;
  });
}

export async function routesJournal(app, { pool }) {
  // Les plus récentes d'abord ; `avant` est l'identifiant de la dernière ligne reçue.
  app.get('/journal', {
    schema: { querystring: { type: 'object', properties: { avant: { type: 'integer', minimum: 1 }, limite: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } } },
  }, async (requete) => {
    const { avant = null, limite } = requete.query;
    const { rows } = await pool.query(
      `SELECT id, cree_le, auteur_id, auteur_nom, action, cible, details FROM journal_admin
       WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
      [avant, limite + 1],
    );
    return {
      lignes: rows.slice(0, limite).map((l) => ({
        id: Number(l.id), le: l.cree_le, auteur: l.auteur_nom, action: l.action, cible: l.cible, details: l.details,
      })),
      suite: rows.length > limite ? Number(rows[limite - 1].id) : null,
    };
  });
}
