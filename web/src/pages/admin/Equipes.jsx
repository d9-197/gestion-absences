import { useState } from 'react';
import { appeler } from '../../api.js';
import { useDonnees, useEnvoi } from '../../donnees.js';
import Cadre from '../../composants/Cadre.jsx';
import Dialogue, { ActionsDialogue } from '../../composants/Dialogue.jsx';

// Met les équipes dans l'ordre de l'arborescence, avec leur profondeur.
function enArbre(equipes) {
  const resultat = [];
  const ajouter = (parentId, niveau) => {
    for (const equipe of equipes.filter((e) => e.parentId === parentId)) {
      resultat.push({ ...equipe, niveau });
      ajouter(equipe.id, niveau + 1);
    }
  };
  ajouter(null, 0);
  return resultat;
}

function descendance(equipes, id) {
  const filles = equipes.filter((e) => e.parentId === id);
  return [id, ...filles.flatMap((e) => descendance(equipes, e.id))];
}

function Formulaire({ equipe, equipes, valideurs, onFermer, onEnregistre }) {
  const creation = !equipe;
  const [champs, setChamps] = useState({
    nom: equipe?.nom ?? '',
    parentId: equipe?.parentId ?? '',
    responsableId: equipe?.responsableId ?? '',
    delegueIds: equipe?.delegueIds ?? [],
    actif: equipe?.actif ?? true,
  });
  const { enCours, erreur, envoyer } = useEnvoi();
  // Une équipe ne peut pas être rattachée à elle-même ni à l'une de ses sous-équipes.
  const exclues = creation ? [] : descendance(equipes, equipe.id);
  const parentes = enArbre(equipes).filter((e) => !exclues.includes(e.id));

  const basculerDelegue = (id) => setChamps({
    ...champs,
    delegueIds: champs.delegueIds.includes(id) ? champs.delegueIds.filter((d) => d !== id) : [...champs.delegueIds, id],
  });

  async function soumettre(evenement) {
    evenement.preventDefault();
    const corps = {
      nom: champs.nom,
      parentId: champs.parentId === '' ? null : Number(champs.parentId),
      responsableId: champs.responsableId === '' ? null : Number(champs.responsableId),
    };
    const reussi = await envoyer(async () => {
      const enregistree = creation
        ? await appeler('/admin/equipes', { methode: 'POST', corps })
        : await appeler(`/admin/equipes/${equipe.id}`, { methode: 'PATCH', corps: { ...corps, actif: champs.actif } });
      await appeler(`/admin/equipes/${enregistree.id}/delegues`, { methode: 'PUT', corps: { delegueIds: champs.delegueIds } });
    });
    if (reussi) onEnregistre(`L'équipe « ${champs.nom.trim()} » est ${creation ? 'créée' : 'modifiée'}.`);
  }

  return (
    <Dialogue titre={creation ? 'Ajouter une équipe' : "Modifier l'équipe"} onFermer={onFermer}>
      <form onSubmit={soumettre}>
        {erreur && <p className="message erreur" role="alert">{erreur}</p>}
        <label htmlFor="e-nom">Nom</label>
        <input id="e-nom" required maxLength={100} value={champs.nom}
          onChange={(e) => setChamps({ ...champs, nom: e.target.value })} />
        <label htmlFor="e-parent">Équipe parente</label>
        <select id="e-parent" value={champs.parentId} onChange={(e) => setChamps({ ...champs, parentId: e.target.value })}>
          <option value="">Aucune (équipe racine)</option>
          {parentes.map((e) => <option key={e.id} value={e.id}>{'  '.repeat(e.niveau)}{e.nom}</option>)}
        </select>
        <label htmlFor="e-responsable">Responsable</label>
        <select id="e-responsable" value={champs.responsableId}
          onChange={(e) => setChamps({ ...champs, responsableId: e.target.value })}>
          <option value="">Aucun</option>
          {valideurs.map((c) => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
        </select>
        <p className="aide">Seuls les responsables et les directeurs actifs peuvent être choisis.</p>
        <fieldset>
          <legend>Délégués</legend>
          {valideurs.length === 0 && <p className="aide">Aucun responsable ou directeur disponible.</p>}
          {valideurs.map((c) => (
            <label className="case" key={c.id}>
              <input type="checkbox" checked={champs.delegueIds.includes(c.id)} onChange={() => basculerDelegue(c.id)} />
              {c.prenom} {c.nom}
            </label>
          ))}
        </fieldset>
        {!creation && (
          <label className="case">
            <input type="checkbox" checked={champs.actif} onChange={(e) => setChamps({ ...champs, actif: e.target.checked })} />
            Équipe active
          </label>
        )}
        <ActionsDialogue onFermer={onFermer} enCours={enCours} />
      </form>
    </Dialogue>
  );
}

export default function Equipes() {
  const equipes = useDonnees('/admin/equipes');
  const collaborateurs = useDonnees('/admin/collaborateurs');
  const [edition, setEdition] = useState(null);
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');

  if (!equipes.donnees || !collaborateurs.donnees) {
    return <Cadre><p className={equipes.erreur ? 'message erreur' : 'chargement'}>{equipes.erreur || collaborateurs.erreur || 'Chargement…'}</p></Cadre>;
  }
  const nom = Object.fromEntries(collaborateurs.donnees.map((c) => [c.id, `${c.prenom} ${c.nom}`]));
  const valideurs = collaborateurs.donnees.filter((c) => c.actif && c.role !== 'collaborateur');

  async function supprimer(equipe) {
    setInfo('');
    setErreur('');
    if (!window.confirm(`Supprimer l'équipe « ${equipe.nom} » ?`)) return;
    try {
      await appeler(`/admin/equipes/${equipe.id}`, { methode: 'DELETE' });
      setInfo(`L'équipe « ${equipe.nom} » est supprimée.`);
      equipes.recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Équipes</h1>
        <button className="bouton compact" type="button" onClick={() => setEdition('nouveau')}>Ajouter une équipe</button>
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      <div className="tableau-defilant">
        <table>
          <thead>
            <tr><th>Équipe</th><th>Responsable</th><th>Délégués</th><th className="nombre">Collaborateurs</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {enArbre(equipes.donnees).map((e) => (
              <tr key={e.id} className={e.actif ? undefined : 'inactif'}>
                <td style={{ paddingLeft: `${0.75 + e.niveau * 1.5}rem` }}>
                  {e.niveau > 0 && <span aria-hidden="true">└ </span>}{e.nom}
                  {!e.actif && <span className="pastille">Désactivée</span>}
                </td>
                <td>{e.responsableId ? nom[e.responsableId] : <span className="manquant">Aucun</span>}</td>
                <td>{e.delegueIds.map((id) => nom[id]).join(', ') || '—'}</td>
                <td className="nombre">{e.nbCollaborateurs}</td>
                <td className="actions-ligne">
                  <button className="bouton lien" type="button" onClick={() => setEdition(e)}
                    aria-label={`Modifier l'équipe ${e.nom}`}>Modifier</button>
                  <button className="bouton lien" type="button" onClick={() => supprimer(e)}
                    aria-label={`Supprimer l'équipe ${e.nom}`}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && (
        <Formulaire
          equipe={edition === 'nouveau' ? null : edition}
          equipes={equipes.donnees}
          valideurs={valideurs}
          onFermer={() => setEdition(null)}
          onEnregistre={(message) => { setEdition(null); setErreur(''); setInfo(message); equipes.recharger(); }}
        />
      )}
    </Cadre>
  );
}
