import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const dossier = fileURLToPath(new URL('../migrations', import.meta.url));

// Applique les migrations en attente. À exécuter avec le compte propriétaire, jamais avec le compte applicatif.
export async function migrer(connexion, { log = console.log } = {}) {
  return runner({
    databaseUrl: connexion,
    dir: dossier,
    direction: 'up',
    migrationsTable: 'migrations',
    checkOrder: true,
    log,
  });
}
