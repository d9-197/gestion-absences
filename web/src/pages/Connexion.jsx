import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { appeler } from '../api.js';
import { useSession } from '../session.jsx';

const ERREURS = {
  microsoft: 'La connexion avec Microsoft a échoué. Réessayez.',
  'compte-inconnu': "Votre compte Microsoft n'est rattaché à aucun collaborateur de l'outil. Contactez un directeur.",
};

export default function Connexion() {
  const { utilisateur, recharger } = useSession();
  const [parametres] = useSearchParams();
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState(ERREURS[parametres.get('erreur')] ?? '');
  const [enCours, setEnCours] = useState(false);
  const [microsoft, setMicrosoft] = useState(false);

  useEffect(() => {
    appeler('/auth/config').then((config) => setMicrosoft(config.microsoft)).catch(() => {});
  }, []);

  if (utilisateur) return <Navigate to="/" replace />;

  async function soumettre(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnCours(true);
    try {
      await appeler('/auth/connexion', { methode: 'POST', corps: { email, motDePasse } });
      // Les identifiants sont bons, mais le navigateur peut refuser le cookie de session (adresse en HTTP, par exemple).
      if (!(await recharger())) {
        setErreur(
          "Identifiants corrects, mais le navigateur n'a pas conservé la session. "
          + "Si l'application est servie en HTTP, l'administrateur doit vérifier APP_URL et COOKIE_SECURE (voir le README).",
        );
      }
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <main className="carte">
      <h1>Gestion des absences</h1>
      {parametres.get('motdepasse') === 'defini' && (
        <p className="message succes" role="status">Mot de passe enregistré. Vous pouvez vous connecter.</p>
      )}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}

      {microsoft && (
        <>
          <a className="bouton secondaire" href="/api/auth/microsoft">Se connecter avec Microsoft</a>
          <p className="separateur">ou</p>
        </>
      )}

      <form onSubmit={soumettre}>
        <label htmlFor="email">Adresse e-mail</label>
        <input id="email" type="email" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="mot-de-passe">Mot de passe</label>
        <input id="mot-de-passe" type="password" autoComplete="current-password" required
          value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
        <button className="bouton" type="submit" disabled={enCours}>
          {enCours ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="lien-bas"><Link to="/mot-de-passe-oublie">Mot de passe oublié ou première connexion</Link></p>
    </main>
  );
}
