import { useState } from 'react';
import { appeler } from '../../api.js';
import { useDonnees, useEnvoi } from '../../donnees.js';
import { useSession } from '../../session.jsx';
import Cadre from '../../composants/Cadre.jsx';
import Dialogue, { ActionsDialogue } from '../../composants/Dialogue.jsx';

const ROLES = { collaborateur: 'Collaborateur', responsable: 'Responsable', directeur: 'Directeur' };

function connexion(c) {
  const modes = [c.aMotDePasse && 'Mot de passe', c.aMicrosoft && 'Microsoft'].filter(Boolean);
  return modes.length ? modes.join(' et ') : 'Jamais connecté';
}

function Formulaire({ collaborateur, equipes, estSoi, onFermer, onEnregistre }) {
  const creation = !collaborateur;
  const [champs, setChamps] = useState({
    prenom: collaborateur?.prenom ?? '',
    nom: collaborateur?.nom ?? '',
    email: collaborateur?.email ?? '',
    equipeId: collaborateur?.equipeId ?? equipes[0]?.id ?? '',
    role: collaborateur?.role ?? 'collaborateur',
    actif: collaborateur?.actif ?? true,
    inviter: true,
  });
  const { enCours, erreur, envoyer } = useEnvoi();
  const modifier = (champ) => (e) =>
    setChamps({ ...champs, [champ]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function soumettre(evenement) {
    evenement.preventDefault();
    const { inviter, actif, ...commun } = { ...champs, equipeId: Number(champs.equipeId) };
    let message;
    const reussi = await envoyer(async () => {
      if (creation) {
        const cree = await appeler('/admin/collaborateurs', { methode: 'POST', corps: { ...commun, inviter } });
        message = cree.invitationEnvoyee === false
          ? `${cree.prenom} ${cree.nom} est créé, mais l'e-mail d'invitation n'a pas pu être envoyé.`
          : `${cree.prenom} ${cree.nom} est créé${inviter ? ' et son invitation est envoyée' : ''}.`;
      } else {
        // Son propre rôle et son propre état ne sont pas modifiables : ils ne sont pas envoyés.
        const corps = estSoi ? { prenom: commun.prenom, nom: commun.nom, email: commun.email, equipeId: commun.equipeId } : { ...commun, actif };
        await appeler(`/admin/collaborateurs/${collaborateur.id}`, { methode: 'PATCH', corps });
        message = `${commun.prenom} ${commun.nom} est modifié.`;
      }
    });
    if (reussi) onEnregistre(message);
  }

  return (
    <Dialogue titre={creation ? 'Ajouter un collaborateur' : 'Modifier le collaborateur'} onFermer={onFermer}>
      <form onSubmit={soumettre}>
        {erreur && <p className="message erreur" role="alert">{erreur}</p>}
        <label htmlFor="c-prenom">Prénom</label>
        <input id="c-prenom" required maxLength={100} value={champs.prenom} onChange={modifier('prenom')} />
        <label htmlFor="c-nom">Nom</label>
        <input id="c-nom" required maxLength={100} value={champs.nom} onChange={modifier('nom')} />
        <label htmlFor="c-email">Adresse e-mail</label>
        <input id="c-email" type="email" required value={champs.email} onChange={modifier('email')} />
        <label htmlFor="c-equipe">Équipe</label>
        <select id="c-equipe" required value={champs.equipeId} onChange={modifier('equipeId')}>
          {equipes.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
        <label htmlFor="c-role">Rôle</label>
        <select id="c-role" value={champs.role} onChange={modifier('role')} disabled={estSoi}>
          {Object.entries(ROLES).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
        </select>
        {estSoi && <p className="aide">Vous ne pouvez pas changer votre propre rôle ni vous désactiver.</p>}
        {creation ? (
          <label className="case">
            <input type="checkbox" checked={champs.inviter} onChange={modifier('inviter')} />
            Envoyer une invitation par e-mail pour choisir son mot de passe
          </label>
        ) : !estSoi && (
          <label className="case">
            <input type="checkbox" checked={champs.actif} onChange={modifier('actif')} />
            Compte actif
          </label>
        )}
        <ActionsDialogue onFermer={onFermer} enCours={enCours} />
      </form>
    </Dialogue>
  );
}

// Import d'une liste de collaborateurs depuis un fichier CSV (mise en route). Tout ou rien, après vérification.
function Import({ onFermer, onImporte }) {
  const [csv, setCsv] = useState('');
  const [rapport, setRapport] = useState(null);
  const { enCours, erreur, envoyer } = useEnvoi();

  const lireFichier = async (evenement) => {
    const fichier = evenement.target.files?.[0];
    if (fichier) { setCsv(await fichier.text()); setRapport(null); }
  };
  const lancer = (simulation) => envoyer(async () => {
    const resultat = await appeler('/admin/collaborateurs/import', { methode: 'POST', corps: { csv, simulation } });
    setRapport(resultat);
    if (resultat.importes) onImporte(`${resultat.importes} collaborateur${resultat.importes > 1 ? 's' : ''} importé${resultat.importes > 1 ? 's' : ''}. Aucun e-mail n'a été envoyé : utilisez « Inviter » pour chacun.`);
  });
  const erreurs = rapport?.lignes.filter((l) => l.erreurs.length) ?? [];

  return (
    <Dialogue titre="Importer des collaborateurs" onFermer={onFermer}>
      <p className="aide">
        Fichier CSV (séparateur « ; » ou « , ») avec une ligne d'en-têtes : <code>email;nom;prenom;equipe;role</code>. Le rôle est facultatif
        (collaborateur par défaut). Les équipes doivent déjà exister. Rien n'est créé tant que toutes les lignes ne sont pas valides.
      </p>
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      <label htmlFor="import-fichier">Fichier</label>
      <input id="import-fichier" type="file" accept=".csv,text/csv,text/plain" onChange={lireFichier} />
      <label htmlFor="import-texte">ou contenu à coller</label>
      <textarea id="import-texte" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setRapport(null); }} spellCheck={false} />
      {rapport && (
        <div role="status">
          {rapport.valide
            ? <p className="message succes">{rapport.lignes.length} ligne{rapport.lignes.length > 1 ? 's' : ''} valide{rapport.lignes.length > 1 ? 's' : ''} : l'import peut être lancé.</p>
            : <p className="message erreur">{erreurs.length} ligne{erreurs.length > 1 ? 's' : ''} à corriger ; rien n'a été importé.</p>}
          {erreurs.length > 0 && (
            <ul className="liste-simple">
              {erreurs.map((l) => <li key={l.ligne}>Ligne {l.ligne} ({l.email || 'sans e-mail'}) : {l.erreurs.join(' ; ')}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="actions">
        <button className="bouton secondaire" type="button" onClick={onFermer}>Fermer</button>
        <button className="bouton secondaire" type="button" disabled={enCours || !csv.trim()} onClick={() => lancer(true)}>Vérifier</button>
        <button className="bouton" type="button" disabled={enCours || !csv.trim() || !rapport?.valide || rapport.importes > 0} onClick={() => lancer(false)}>Importer</button>
      </div>
    </Dialogue>
  );
}

export default function Collaborateurs() {
  const { utilisateur } = useSession();
  const collaborateurs = useDonnees('/admin/collaborateurs');
  const equipes = useDonnees('/admin/equipes');
  const [edition, setEdition] = useState(null); // null, 'nouveau' ou le collaborateur modifié
  const [avecInactifs, setAvecInactifs] = useState(false);
  const [importer, setImport] = useState(false);
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');

  if (!collaborateurs.donnees || !equipes.donnees) {
    return <Cadre><p className={collaborateurs.erreur ? 'message erreur' : 'chargement'}>{collaborateurs.erreur || equipes.erreur || 'Chargement…'}</p></Cadre>;
  }
  const nomEquipe = Object.fromEntries(equipes.donnees.map((e) => [e.id, e.nom]));
  const visibles = collaborateurs.donnees.filter((c) => avecInactifs || c.actif);
  const nbInactifs = collaborateurs.donnees.filter((c) => !c.actif).length;

  async function inviter(c) {
    setInfo('');
    setErreur('');
    try {
      await appeler(`/admin/collaborateurs/${c.id}/invitation`, { methode: 'POST' });
      setInfo(`Invitation envoyée à ${c.email}.`);
    } catch (e) {
      setErreur(e.message);
    }
  }

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Collaborateurs</h1>
        <span className="groupe-boutons">
          <button className="bouton secondaire compact" type="button" onClick={() => setImport(true)}
            disabled={!equipes.donnees.some((e) => e.actif)}>Importer un CSV</button>
          <button className="bouton compact" type="button" onClick={() => setEdition('nouveau')}
            disabled={!equipes.donnees.some((e) => e.actif)}>Ajouter un collaborateur</button>
        </span>
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      {nbInactifs > 0 && (
        <label className="case">
          <input type="checkbox" checked={avecInactifs} onChange={(e) => setAvecInactifs(e.target.checked)} />
          Afficher les comptes désactivés ({nbInactifs})
        </label>
      )}
      <div className="tableau-defilant">
        <table>
          <thead>
            <tr><th>Nom</th><th>Adresse e-mail</th><th>Équipe</th><th>Rôle</th><th>Connexion</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={c.id} className={c.actif ? undefined : 'inactif'}>
                <td>{c.prenom} {c.nom}{!c.actif && <span className="pastille">Désactivé</span>}</td>
                <td>{c.email}</td>
                <td>{nomEquipe[c.equipeId]}</td>
                <td>{ROLES[c.role]}</td>
                <td>{connexion(c)}</td>
                <td className="actions-ligne">
                  <button className="bouton lien" type="button" onClick={() => setEdition(c)}
                    aria-label={`Modifier ${c.prenom} ${c.nom}`}>Modifier</button>
                  {c.actif && (
                    <button className="bouton lien" type="button" onClick={() => inviter(c)}
                      aria-label={`Envoyer une invitation à ${c.prenom} ${c.nom}`}>Inviter</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {importer && (
        <Import onFermer={() => { setImport(false); collaborateurs.recharger(); }}
          onImporte={(message) => { setErreur(''); setInfo(message); collaborateurs.recharger(); }} />
      )}
      {edition && (
        <Formulaire
          collaborateur={edition === 'nouveau' ? null : edition}
          equipes={equipes.donnees.filter((e) => e.actif || e.id === edition.equipeId)}
          estSoi={edition !== 'nouveau' && edition.id === utilisateur.id}
          onFermer={() => setEdition(null)}
          onEnregistre={(message) => { setEdition(null); setErreur(''); setInfo(message); collaborateurs.recharger(); }}
        />
      )}
    </Cadre>
  );
}
