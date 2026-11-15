import { ErreurMetier } from '../erreurs.js';

// Tri alphabétique français, insensible à la casse et aux accents.
const ordreFrancais = new Intl.Collator('fr', { sensitivity: 'base' });
export const trier = (lignes, cle) => [...lignes].sort((a, b) => ordreFrancais.compare(cle(a), cle(b)));

export const parametresId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

// Exécute une fonction dans une transaction, annulée à la première erreur.
export async function transaction(pool, fonction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await fonction(client);
    await client.query('COMMIT');
    return resultat;
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  } finally {
    client.release();
  }
}

// Construit « SET colonne = $n, … » à partir des seuls champs présents dans la requête.
export function champsModifies(corps, correspondance) {
  const colonnes = [];
  const valeurs = [];
  for (const [champ, colonne] of Object.entries(correspondance)) {
    if (corps[champ] !== undefined) {
      valeurs.push(corps[champ]);
      colonnes.push(`${colonne} = $${valeurs.length}`);
    }
  }
  // Les champs inconnus sont retirés à la validation : il peut ne rien rester.
  if (!colonnes.length) throw new ErreurMetier(400, 'Aucune modification demandée');
  return { colonnes, valeurs };
}

// Un responsable d'équipe ou un délégué doit être actif et avoir le rôle responsable ou directeur.
export async function verifierValideur(client, id, fonction) {
  const { rows } = await client.query('SELECT prenom, nom, role, actif FROM collaborateurs WHERE id = $1', [id]);
  const personne = rows[0];
  if (!personne) throw new ErreurMetier(400, `${fonction} : collaborateur inconnu`);
  if (!personne.actif || !['responsable', 'directeur'].includes(personne.role)) {
    throw new ErreurMetier(
      400,
      `${fonction} : ${personne.prenom} ${personne.nom} doit être actif et avoir le rôle responsable ou directeur`,
    );
  }
}
