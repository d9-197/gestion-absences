import { useState } from 'react';
import { appeler } from '../../api.js';
import { useDonnees, useEnvoi } from '../../donnees.js';
import Cadre from '../../composants/Cadre.jsx';
import Dialogue, { ActionsDialogue } from '../../composants/Dialogue.jsx';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function Formulaire({ type, onFermer, onEnregistre }) {
  const creation = !type;
  const [champs, setChamps] = useState({
    libelle: type?.libelle ?? '',
    approbationRequise: type?.approbationRequise ?? true,
    confidentiel: type?.confidentiel ?? false,
    delai: type?.delaiPrevenanceJours ?? '',
    actif: type?.actif ?? true,
    compteurActif: type?.compteurActif ?? false,
    dotation: type?.dotationAnnuelle ?? '',
    debutPeriodeMois: type?.debutPeriodeMois ?? 1,
    reportAutomatique: type?.reportAutomatique ?? true,
  });
  const { enCours, erreur, envoyer } = useEnvoi();
  const cocher = (champ) => (e) => setChamps({ ...champs, [champ]: e.target.checked });

  async function soumettre(evenement) {
    evenement.preventDefault();
    const corps = {
      libelle: champs.libelle,
      approbationRequise: champs.approbationRequise,
      confidentiel: champs.confidentiel,
      delaiPrevenanceJours: champs.delai === '' ? null : Number(champs.delai),
      compteurActif: champs.compteurActif,
      dotationAnnuelle: champs.dotation === '' ? null : Number(champs.dotation),
      debutPeriodeMois: Number(champs.debutPeriodeMois),
      reportAutomatique: champs.reportAutomatique,
    };
    const reussi = await envoyer(() => (creation
      ? appeler('/admin/types-absence', { methode: 'POST', corps })
      : appeler(`/admin/types-absence/${type.id}`, { methode: 'PATCH', corps: { ...corps, actif: champs.actif } })));
    if (reussi) onEnregistre(`Le type « ${champs.libelle.trim()} » est ${creation ? 'créé' : 'modifié'}.`);
  }

  return (
    <Dialogue titre={creation ? "Ajouter un type d'absence" : "Modifier le type d'absence"} onFermer={onFermer}>
      <form onSubmit={soumettre}>
        {erreur && <p className="message erreur" role="alert">{erreur}</p>}
        <label htmlFor="t-libelle">Libellé</label>
        <input id="t-libelle" required maxLength={100} value={champs.libelle}
          onChange={(e) => setChamps({ ...champs, libelle: e.target.value })} />
        <label className="case">
          <input type="checkbox" checked={champs.approbationRequise} onChange={cocher('approbationRequise')} />
          Approbation requise
        </label>
        <p className="aide">Sans approbation, l'absence est une simple déclaration, enregistrée directement.</p>
        <label className="case">
          <input type="checkbox" checked={champs.confidentiel} onChange={cocher('confidentiel')} />
          Confidentiel
        </label>
        <p className="aide">Le planning affiche « absent » sans préciser le type.</p>
        <label htmlFor="t-delai">Délai de prévenance, en jours</label>
        <input id="t-delai" type="number" min="0" max="365" step="1" value={champs.delai}
          aria-describedby="aide-delai" onChange={(e) => setChamps({ ...champs, delai: e.target.value })} />
        <p id="aide-delai" className="aide">Laisser vide pour ne pas contrôler le délai.</p>
        <label className="case">
          <input type="checkbox" checked={champs.compteurActif} onChange={cocher('compteurActif')} />
          Compteur de solde (indicatif)
        </label>
        <p className="aide">Suit un solde en jours par salarié. Il ne s'affiche que si les compteurs sont activés globalement (page « Compteurs »).</p>
        {champs.compteurActif && (
          <>
            <label htmlFor="t-dotation">Droit annuel par défaut, en jours</label>
            <input id="t-dotation" type="number" min="0" max="400" step="0.5" value={champs.dotation}
              onChange={(e) => setChamps({ ...champs, dotation: e.target.value })} />
            <p className="aide">Acquis par douzième au 1er de chaque mois. Un directeur peut fixer un droit différent pour un salarié. Sans droit, pas de solde.</p>
            <label htmlFor="t-debut-periode">La période de référence commence le 1er…</label>
            <select id="t-debut-periode" value={champs.debutPeriodeMois} onChange={(e) => setChamps({ ...champs, debutPeriodeMois: e.target.value })}>
              {MOIS.map((nom, i) => <option key={nom} value={i + 1}>{nom}</option>)}
            </select>
            <label className="case">
              <input type="checkbox" checked={champs.reportAutomatique} onChange={cocher('reportAutomatique')} />
              Report automatique du reliquat
            </label>
            <p className="aide">
              Activé : le reliquat de la période précédente s'ajoute à la suivante, sans limite, à condition que cette période ait été recalée par le salarié
              (sans recalage, son solde est inconnu et rien n'est reporté). Désactivé : un directeur saisit le report de chaque salarié.
            </p>
          </>
        )}
        {!creation && (
          <label className="case">
            <input type="checkbox" checked={champs.actif} onChange={cocher('actif')} />
            Type proposé à la saisie
          </label>
        )}
        {!creation && type.utilise && (
          <p className="aide">Les demandes déjà enregistrées avec ce type ne sont pas modifiées.</p>
        )}
        <ActionsDialogue onFermer={onFermer} enCours={enCours} />
      </form>
    </Dialogue>
  );
}

const ouiNon = (valeur) => (valeur ? 'Oui' : 'Non');

export default function TypesAbsence() {
  const types = useDonnees('/admin/types-absence');
  const [edition, setEdition] = useState(null);
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');

  if (!types.donnees) {
    return <Cadre><p className={types.erreur ? 'message erreur' : 'chargement'}>{types.erreur || 'Chargement…'}</p></Cadre>;
  }

  async function supprimer(type) {
    setInfo('');
    setErreur('');
    if (!window.confirm(`Supprimer le type « ${type.libelle} » ?`)) return;
    try {
      await appeler(`/admin/types-absence/${type.id}`, { methode: 'DELETE' });
      setInfo(`Le type « ${type.libelle} » est supprimé.`);
      types.recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Types d'absence</h1>
        <button className="bouton compact" type="button" onClick={() => setEdition('nouveau')}>Ajouter un type</button>
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      <div className="tableau-defilant">
        <table>
          <thead>
            <tr><th>Libellé</th><th>Approbation</th><th>Confidentiel</th><th>Délai de prévenance</th><th>Compteur</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {types.donnees.map((t) => (
              <tr key={t.id} className={t.actif ? undefined : 'inactif'}>
                <td>{t.libelle}{!t.actif && <span className="pastille">Désactivé</span>}</td>
                <td>{ouiNon(t.approbationRequise)}</td>
                <td>{ouiNon(t.confidentiel)}</td>
                <td>{t.delaiPrevenanceJours === null ? '—' : `${t.delaiPrevenanceJours} jour${t.delaiPrevenanceJours > 1 ? 's' : ''}`}</td>
                <td>{t.compteurActif ? (t.dotationAnnuelle === null ? 'Sans droit défini' : `${t.dotationAnnuelle.toLocaleString('fr-FR')} j/an`) : '—'}</td>
                <td className="actions-ligne">
                  <button className="bouton lien" type="button" onClick={() => setEdition(t)}
                    aria-label={`Modifier le type ${t.libelle}`}>Modifier</button>
                  {!t.utilise && (
                    <button className="bouton lien" type="button" onClick={() => supprimer(t)}
                      aria-label={`Supprimer le type ${t.libelle}`}>Supprimer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && (
        <Formulaire
          type={edition === 'nouveau' ? null : edition}
          onFermer={() => setEdition(null)}
          onEnregistre={(message) => { setEdition(null); setErreur(''); setInfo(message); types.recharger(); }}
        />
      )}
    </Cadre>
  );
}
