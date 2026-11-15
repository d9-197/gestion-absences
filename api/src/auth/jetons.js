import { createHash, randomBytes } from 'node:crypto';

// Jeton aléatoire remis au client ; seule son empreinte est stockée en base.
export const nouveauJeton = () => randomBytes(32).toString('base64url');
export const empreinte = (jeton) => createHash('sha256').update(String(jeton)).digest('hex');

// Crée un jeton à usage unique pour définir un mot de passe et renvoie le lien à transmettre.
export async function creerLienMotDePasse(pool, { collaborateurId, dureeHeures, appUrl }) {
  const jeton = nouveauJeton();
  await pool.query(
    `INSERT INTO jetons_mot_de_passe (jeton_hash, collaborateur_id, expire_le)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [empreinte(jeton), collaborateurId, dureeHeures],
  );
  return `${appUrl}/definir-mot-de-passe?jeton=${jeton}`;
}
