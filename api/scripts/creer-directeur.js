// Crée le premier directeur et son équipe, puis affiche un lien pour définir son mot de passe.
// Usage : docker compose exec api node scripts/creer-directeur.js <email> <prénom> <nom> [équipe]
import pg from 'pg';
import { config } from '../src/config.js';
import { creerLienMotDePasse } from '../src/auth/jetons.js';

const [email, prenom, nom, equipe = 'Direction'] = process.argv.slice(2);
if (!email || !prenom || !nom) {
  console.error('Usage : node scripts/creer-directeur.js <email> <prénom> <nom> [équipe]');
  process.exit(2);
}

const pool = new pg.Pool(config.db);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const existants = await client.query(`SELECT count(*)::int AS n FROM collaborateurs WHERE role = 'directeur' AND actif`);
  if (existants.rows[0].n > 0) {
    throw new Error("Un directeur existe déjà : les suivants se créent depuis l'application.");
  }
  let { rows } = await client.query('SELECT id FROM equipes WHERE lower(nom) = lower($1)', [equipe]);
  if (!rows.length) ({ rows } = await client.query('INSERT INTO equipes (nom) VALUES ($1) RETURNING id', [equipe]));
  const equipeId = rows[0].id;
  const directeur = await client.query(
    `INSERT INTO collaborateurs (email, prenom, nom, equipe_id, role) VALUES ($1, $2, $3, $4, 'directeur') RETURNING id`,
    [email.trim(), prenom, nom, equipeId],
  );
  await client.query('UPDATE equipes SET responsable_id = $1 WHERE id = $2 AND responsable_id IS NULL', [
    directeur.rows[0].id, equipeId,
  ]);
  const lien = await creerLienMotDePasse(client, {
    collaborateurId: directeur.rows[0].id, dureeHeures: 72, appUrl: config.appUrl,
  });
  await client.query('COMMIT');
  console.log(`Directeur créé : ${prenom} ${nom} <${email}>, équipe « ${equipe} ».`);
  console.log('Lien pour définir le mot de passe (valable 72 heures, usage unique) :');
  console.log(lien);
} catch (erreur) {
  await client.query('ROLLBACK');
  console.error(`Échec : ${erreur.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
