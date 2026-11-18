import { useState } from 'react';
import { Link } from 'react-router';
import { appeler } from '../api.js';
import { useEnvoi } from '../donnees.js';
import { useSession } from '../session.jsx';
import Cadre from '../composants/Cadre.jsx';

export const ROLES = { collaborateur: 'Collaborateur', responsable: 'Responsable', directeur: 'Directeur' };
const LONGUEUR_MINIMALE = 12;

export default function Compte() {
  const { utilisateur } = useSession();
  const [champs, setChamps] = useState({ actuel: '', nouveau: '', confirmation: '' });
  const [info, setInfo] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();
  const modifier = (champ) => (e) => setChamps({ ...champs, [champ]: e.target.value });

  async function soumettre(evenement) {
    evenement.preventDefault();
    setInfo('');
    if (champs.nouveau !== champs.confirmation) {
      await envoyer(async () => { throw new Error('Les deux nouveaux mots de passe ne sont pas identiques.'); });
      return;
    }
    const reussi = await envoyer(() => appeler('/auth/mot-de-passe/changer', {
      methode: 'POST', corps: { motDePasseActuel: champs.actuel, nouveauMotDePasse: champs.nouveau },
    }));
    if (reussi) {
      setChamps({ actuel: '', nouveau: '', confirmation: '' });
      setInfo('Votre mot de passe est modifié. Vos autres sessions ont été fermées et un e-mail vous a prévenu.');
    }
  }

  return (
    <Cadre>
      <div className="entete-page"><h1>Mon compte</h1></div>
      <dl className="fiche">
        <dt>Nom</dt><dd>{utilisateur.prenom} {utilisateur.nom}</dd>
        <dt>Adresse e-mail</dt><dd>{utilisateur.email}</dd>
        <dt>Équipe</dt><dd>{utilisateur.equipe.nom}</dd>
        <dt>Rôle</dt><dd>{ROLES[utilisateur.role]}</dd>
      </dl>

      <section aria-labelledby="titre-mdp">
        <h2 id="titre-mdp">Mot de passe</h2>
        {info && <p className="message succes" role="status">{info}</p>}
        {!utilisateur.aMotDePasse ? (
          <p>
            Ce compte n'a pas de mot de passe : il se connecte avec Microsoft. Pour en définir un,
            utilisez <Link to="/mot-de-passe-oublie">« Mot de passe oublié »</Link>.
          </p>
        ) : (
          <form onSubmit={soumettre} className="formulaire-large">
            {erreur && <p className="message erreur" role="alert">{erreur}</p>}
            <label htmlFor="mdp-actuel">Mot de passe actuel</label>
            <input id="mdp-actuel" type="password" autoComplete="current-password" required
              value={champs.actuel} onChange={modifier('actuel')} />
            <label htmlFor="mdp-nouveau">Nouveau mot de passe</label>
            <input id="mdp-nouveau" type="password" autoComplete="new-password" required minLength={LONGUEUR_MINIMALE}
              aria-describedby="aide-mdp" value={champs.nouveau} onChange={modifier('nouveau')} />
            <p id="aide-mdp" className="aide">{LONGUEUR_MINIMALE} caractères au minimum.</p>
            <label htmlFor="mdp-confirmation">Confirmer le nouveau mot de passe</label>
            <input id="mdp-confirmation" type="password" autoComplete="new-password" required
              value={champs.confirmation} onChange={modifier('confirmation')} />
            <div className="actions">
              <button className="bouton" type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Changer le mot de passe'}</button>
            </div>
          </form>
        )}
      </section>
    </Cadre>
  );
}
