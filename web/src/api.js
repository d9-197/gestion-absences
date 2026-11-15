// Appels à l'API. Le cookie de session est envoyé automatiquement (même origine).
export class ErreurApi extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

export async function appeler(chemin, { methode = 'GET', corps } = {}) {
  const reponse = await fetch(`/api${chemin}`, {
    method: methode,
    headers: corps === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  if (reponse.status === 204) return null;
  const donnees = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    const message = reponse.status === 429
      ? 'Trop de tentatives. Réessayez dans une minute.'
      : donnees?.erreur ?? 'Une erreur est survenue. Réessayez.';
    throw new ErreurApi(reponse.status, message);
  }
  return donnees;
}
