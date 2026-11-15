// Lancé par le conteneur « migrations » avant le démarrage de l'API.
import { migrer } from '../src/migrations.js';

function requis(nom) {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

try {
  const appliquees = await migrer({
    host: requis('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    database: requis('DB_NAME'),
    user: requis('DB_USER'),
    password: requis('DB_PASSWORD'),
  });
  console.log(appliquees.length ? `${appliquees.length} migration(s) appliquée(s)` : 'Base déjà à jour');
} catch (erreur) {
  console.error('Échec des migrations :', erreur);
  process.exit(1);
}
