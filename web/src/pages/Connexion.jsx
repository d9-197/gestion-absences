import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { appeler } from '../api.js';
import { useSession } from '../session.jsx';

const ERREURS = {
  microsoft: 'La connexion avec Microsoft a échoué. Réessayez.',
  'compte-inconnu': "Votre compte Microsoft n'est rattaché à aucun collaborateur de l'outil. Contactez un directeur.",
};

const MESSAGE_SESSION_PERDUE = "Identifiants corrects, mais le navigateur n'a pas conservé la session. "
  + "Si l'application est servie en HTTP, l'administrateur doit vérifier APP_URL et COOKIE_SECURE (voir le README).";

const ROLES = { collaborateur: 'Collaborateur', responsable: 'Responsable', directeur: 'Directeur' };

// La page demandée avant la connexion n'est reprise que si c'est une adresse interne.
const destinationSure = (depuis) => (typeof depuis === 'string' && /^\/(?!\/)/.test(depuis) && !depuis.startsWith('/connexion') ? depuis : '/');

export default function Connexion() {
  const { utilisateur, motif, recharger } = useSession();
  const lieu = useLocation();
  const [parametres] = useSearchParams();
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState(ERREURS[parametres.get('erreur')] ?? '');
  const [enCours, setEnCours] = useState(false);
  const [microsoft, setMicrosoft] = useState(false);
  // Mode test : liste des comptes pour se connecter sans mot de passe (null : mode désactivé).
  const [comptesTest, setComptesTest] = useState(null);
  const [compteTest, setCompteTest] = useState('');

  useEffect(() => {
    appeler('/auth/config')
      .then(async (config) => {
        setMicrosoft(config.microsoft);
        if (config.autologin) setComptesTest(await appeler('/auth/autologin'));
      })
      .catch(() => {});
  }, []);

  if (utilisateur) return <Navigate to={destinationSure(lieu.state?.depuis)} replace />;

  async function soumettre(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnCours(true);
    try {
      await appeler('/auth/connexion', { methode: 'POST', corps: { email, motDePasse } });
      // Les identifiants sont bons, mais le navigateur peut refuser le cookie de session (adresse en HTTP, par exemple).
      if (!(await recharger())) setErreur(MESSAGE_SESSION_PERDUE);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function connecterEnTest(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnCours(true);
    try {
      await appeler('/auth/autologin', { methode: 'POST', corps: { collaborateurId: Number(compteTest) } });
      if (!(await recharger())) setErreur(MESSAGE_SESSION_PERDUE);
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
      {motif === 'expiree' && (
        <p className="message alerte" role="alert">Votre session a expiré. Reconnectez-vous pour reprendre là où vous en étiez.</p>
      )}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}

      {comptesTest && (
        <form className="mode-test" onSubmit={connecterEnTest} aria-labelledby="titre-mode-test">
          <p id="titre-mode-test"><strong>Mode test : connexion sans mot de passe</strong></p>
          <p className="aide">Réservé aux essais. À désactiver dès qu'ils sont terminés.</p>
          <label htmlFor="compte-test">Se connecter en tant que</label>
          <select id="compte-test" required value={compteTest} onChange={(e) => setCompteTest(e.target.value)}>
            <option value="">Choisir un utilisateur…</option>
            {comptesTest.map((c) => (
              <option key={c.id} value={c.id}>{c.prenom} {c.nom} — {ROLES[c.role]}, {c.equipe}</option>
            ))}
          </select>
          <button className="bouton" type="submit" disabled={enCours || !compteTest}>Se connecter</button>
        </form>
      )}
      {comptesTest && <p className="separateur">ou, avec un mot de passe</p>}

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
