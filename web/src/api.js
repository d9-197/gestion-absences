// Appels à l'API. Le cookie de session est envoyé automatiquement (même origine).
export class ErreurApi extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

const signalerExpiration = () => window.dispatchEvent(new Event('session-expiree'));

export async function appeler(chemin, { methode = 'GET', corps } = {}) {
  const reponse = await fetch(`/api${chemin}`, {
    method: methode,
    headers: corps === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  if (reponse.status === 204) return null;
  const donnees = await reponse.json().catch(() => null);
  // Hors connexion et profil, un 401 veut dire que la session a pris fin : l'application le sait et revient à la connexion.
  if (reponse.status === 401 && !chemin.startsWith('/auth/')) signalerExpiration();
  if (!reponse.ok) {
    const message = reponse.status === 429
      ? 'Trop de tentatives. Réessayez dans une minute.'
      : donnees?.erreur ?? 'Une erreur est survenue. Réessayez.';
    throw new ErreurApi(reponse.status, message);
  }
  return donnees;
}

// Télécharge un fichier produit par l'API (export). Une erreur revient avec son message, comme pour un appel ordinaire.
export async function telecharger(chemin) {
  const reponse = await fetch(`/api${chemin}`);
  if (!reponse.ok) {
    const donnees = await reponse.json().catch(() => null);
    if (reponse.status === 401) signalerExpiration();
    throw new ErreurApi(reponse.status, donnees?.erreur ?? 'Une erreur est survenue. Réessayez.');
  }
  const nom = /filename="([^"]+)"/.exec(reponse.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export';
  return { blob: await reponse.blob(), nom, lignes: Number(reponse.headers.get('X-Lignes') ?? 0) };
}

// Propose le fichier au téléchargement.
export function enregistrerFichier({ blob, nom }) {
  const adresse = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = adresse;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 1000);
}
