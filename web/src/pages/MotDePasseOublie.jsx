import { useState } from 'react';
import { Link } from 'react-router';
import { appeler } from '../api.js';

export default function MotDePasseOublie() {
  const [email, setEmail] = useState('');
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  async function soumettre(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnCours(true);
    try {
      await appeler('/auth/mot-de-passe/oubli', { methode: 'POST', corps: { email } });
      setEnvoye(true);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <main className="carte">
      <h1>Définir un mot de passe</h1>
      {envoye ? (
        <p className="message succes" role="status">
          Si un compte existe pour {email}, un e-mail contenant un lien vient de lui être envoyé.
          Le lien est valable une heure.
        </p>
      ) : (
        <form onSubmit={soumettre}>
          <p>Indiquez votre adresse e-mail : vous recevrez un lien pour choisir votre mot de passe.</p>
          {erreur && <p className="message erreur" role="alert">{erreur}</p>}
          <label htmlFor="email">Adresse e-mail</label>
          <input id="email" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="bouton" type="submit" disabled={enCours}>
            {enCours ? 'Envoi…' : 'Recevoir le lien'}
          </button>
        </form>
      )}
      <p className="lien-bas"><Link to="/connexion">Retour à la connexion</Link></p>
    </main>
  );
}
