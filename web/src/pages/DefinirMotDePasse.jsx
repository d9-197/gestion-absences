import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { appeler } from '../api.js';

const LONGUEUR_MINIMALE = 12;

export default function DefinirMotDePasse() {
  const [parametres] = useSearchParams();
  const naviguer = useNavigate();
  const jeton = parametres.get('jeton');
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  async function soumettre(evenement) {
    evenement.preventDefault();
    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setErreur('');
    setEnCours(true);
    try {
      await appeler('/auth/mot-de-passe/definir', { methode: 'POST', corps: { jeton, motDePasse } });
      naviguer('/connexion?motdepasse=defini', { replace: true });
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <main className="carte">
      <h1>Choisir votre mot de passe</h1>
      {!jeton ? (
        <p className="message erreur" role="alert">Ce lien est incomplet. Demandez-en un nouveau.</p>
      ) : (
        <form onSubmit={soumettre}>
          {erreur && <p className="message erreur" role="alert">{erreur}</p>}
          <label htmlFor="mot-de-passe">Nouveau mot de passe</label>
          <input id="mot-de-passe" type="password" autoComplete="new-password" required
            minLength={LONGUEUR_MINIMALE} aria-describedby="aide-mot-de-passe"
            value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
          <p id="aide-mot-de-passe" className="aide">{LONGUEUR_MINIMALE} caractères au minimum.</p>
          <label htmlFor="confirmation">Confirmer le mot de passe</label>
          <input id="confirmation" type="password" autoComplete="new-password" required
            value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          <button className="bouton" type="submit" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
      )}
      <p className="lien-bas"><Link to="/mot-de-passe-oublie">Demander un nouveau lien</Link></p>
    </main>
  );
}
