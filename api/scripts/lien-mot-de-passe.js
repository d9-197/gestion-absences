// Génère un lien pour choisir un mot de passe, sans passer par l'e-mail. Utile tant que le serveur SMTP
// n'est pas configuré, ou pour essayer l'outil avec les comptes déjà créés.
//
//   docker compose exec api node scripts/lien-mot-de-passe.js                      liste les comptes
//   docker compose exec api node scripts/lien-mot-de-passe.js <email>              lien pour un compte
//   docker compose exec api node scripts/lien-mot-de-passe.js --sans-mot-de-passe  liens pour tous les comptes sans mot de passe
//
// Réservé à qui a accès au serveur, comme la création du premier directeur : l'application elle-même ne propose
// pas de générer un lien à la place d'une autre personne.
import pg from '../src/base.js';
import { config } from '../src/config.js';
import { creerLienMotDePasse } from '../src/auth/jetons.js';

const DUREE_HEURES = 72;
const [argument] = process.argv.slice(2);

const pool = new pg.Pool(config.db);
try {
  if (!argument) {
    const { rows } = await pool.query(
      `SELECT email, prenom, nom, role, actif, mot_de_passe_hash IS NOT NULL AS mdp, microsoft_oid IS NOT NULL AS ms
       FROM collaborateurs ORDER BY lower(nom), lower(prenom)`,
    );
    if (!rows.length) console.log("Aucun compte. Créez le premier directeur avec scripts/creer-directeur.js.");
    for (const c of rows) {
      const acces = [c.mdp && 'mot de passe', c.ms && 'Microsoft'].filter(Boolean).join(' + ') || 'aucun accès défini';
      console.log(`${c.email}\t${c.prenom} ${c.nom}\t${c.role}${c.actif ? '' : ' (désactivé)'}\t${acces}`);
    }
    console.log('\nUsage : node scripts/lien-mot-de-passe.js <email> | --sans-mot-de-passe');
  } else {
    const filtre = argument === '--sans-mot-de-passe'
      ? 'actif AND mot_de_passe_hash IS NULL AND microsoft_oid IS NULL'
      : 'actif AND lower(email) = lower($1)';
    const { rows } = await pool.query(
      `SELECT id, email, prenom, nom FROM collaborateurs WHERE ${filtre} ORDER BY lower(nom), lower(prenom)`,
      argument === '--sans-mot-de-passe' ? [] : [argument.trim()],
    );
    if (!rows.length) {
      throw new Error(argument === '--sans-mot-de-passe'
        ? 'Tous les comptes actifs ont déjà un accès.'
        : `Aucun compte actif pour ${argument}. Lancez le script sans argument pour voir les comptes.`);
    }
    console.log(`Liens valables ${DUREE_HEURES} heures, à usage unique :\n`);
    for (const c of rows) {
      const lien = await creerLienMotDePasse(pool, { collaborateurId: c.id, dureeHeures: DUREE_HEURES, appUrl: config.appUrl });
      console.log(`${c.prenom} ${c.nom} <${c.email}>\n${lien}\n`);
    }
  }
} catch (erreur) {
  console.error(`Échec : ${erreur.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
