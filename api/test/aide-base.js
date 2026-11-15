// Base PostgreSQL jetable pour les tests. Le compte TEST_DB_USER doit être superutilisateur :
// chaque fichier de test crée sa base, y applique les migrations, puis la supprime.
import pg from 'pg';
import { migrer } from '../src/migrations.js';

export const hote = process.env.TEST_DB_HOST;
// À passer en option des tests : ils sont ignorés sans base.
export const options = { skip: hote ? false : 'TEST_DB_HOST non défini' };

export const admin = {
  host: hote,
  port: Number(process.env.TEST_DB_PORT ?? 5432),
  user: process.env.TEST_DB_USER ?? 'absences_owner',
  password: process.env.TEST_DB_PASSWORD,
};

let compteur = 0;

export async function creerBaseDeTest() {
  const suffixe = `${process.pid}_${Date.now()}_${compteur++}`;
  const base = `absences_test_${suffixe}`;
  const compteApi = `test_api_${suffixe}`;

  const racine = new pg.Client({ ...admin, database: 'postgres' });
  await racine.connect();
  await racine.query(`CREATE DATABASE ${base}`);
  await racine.query(`DO $$ BEGIN CREATE ROLE absences_api NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await racine.query(`CREATE ROLE ${compteApi} LOGIN PASSWORD 'test' IN ROLE absences_api`);
  await racine.end();

  const connexionProprietaire = { ...admin, database: base };
  const connexionApi = { ...admin, database: base, user: compteApi, password: 'test' };
  await migrer(connexionProprietaire, { log: () => {} });

  const proprietaire = new pg.Pool(connexionProprietaire); // comme le conteneur de migrations
  const api = new pg.Pool(connexionApi); // comme l'API

  return {
    proprietaire,
    api,
    connexionProprietaire,
    connexionApi,
    async fermer() {
      await proprietaire.end();
      await api.end();
      const menage = new pg.Client({ ...admin, database: 'postgres' });
      await menage.connect();
      await menage.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
      await menage.query(`DROP ROLE IF EXISTS ${compteApi}`);
      await menage.end();
    },
  };
}
