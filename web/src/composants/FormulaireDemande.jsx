import { useEffect, useState } from 'react';
import { appeler } from '../api.js';
import { useDonnees, useEnvoi, notifierChangement } from '../donnees.js';
import { formatDuree, nomComplet } from '../format.js';
import Dialogue, { ActionsDialogue } from './Dialogue.jsx';

// Ce qui pré-remplit le formulaire quand on modifie une demande.
export const initialePourModification = (d) => ({
  collaborateurId: d.collaborateur.id, typeId: d.type.id,
  dateDebut: d.dateDebut, debutDemiJournee: d.debutDemiJournee, dateFin: d.dateFin, finDemiJournee: d.finDemiJournee,
  commentaire: d.commentaire ?? '',
});

const DEMI_JOURNEES = [['matin', 'Matin'], ['apres_midi', 'Après-midi']];

// `initiale` pré-remplit le formulaire : depuis le planning, la personne et la période cliquée ou balayée ; pour une
// modification, toute la demande. Avec `remplace` (le numéro d'une demande en attente), l'envoi retire cette demande
// et la remplace par la nouvelle.
export default function FormulaireDemande({ initiale = {}, remplace = null, onFermer, onEnregistre }) {
  const types = useDonnees('/demandes/types');
  const personnes = useDonnees('/demandes/collaborateurs');
  const [champs, setChamps] = useState({
    collaborateurId: initiale.collaborateurId ? String(initiale.collaborateurId) : '',
    typeId: initiale.typeId ? String(initiale.typeId) : '',
    dateDebut: initiale.dateDebut ?? '',
    debutDemiJournee: initiale.debutDemiJournee ?? 'matin',
    dateFin: initiale.dateFin ?? initiale.dateDebut ?? '', // une seule journée par défaut : on ajuste la fin si besoin
    finDemiJournee: initiale.finDemiJournee ?? 'apres_midi',
    commentaire: initiale.commentaire ?? '',
  });
  const [apercu, setApercu] = useState(null);
  const [erreurApercu, setErreurApercu] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();

  const moi = personnes.donnees?.[0]; // la liste commence par la personne connectée
  const collaborateurId = Number(champs.collaborateurId || moi?.id || 0);
  const pourUnAutre = moi && collaborateurId !== moi.id;
  const modifier = (champ) => (e) => setChamps({ ...champs, [champ]: e.target.value });

  const corps = {
    typeId: Number(champs.typeId),
    ...(pourUnAutre && !remplace ? { collaborateurId } : {}),
    dateDebut: champs.dateDebut,
    debutDemiJournee: champs.debutDemiJournee,
    dateFin: champs.dateFin,
    finDemiJournee: champs.finDemiJournee,
    ...(champs.commentaire.trim() ? { commentaire: champs.commentaire } : {}),
  };

  // La période est cohérente : on peut demander au serveur ce que donnerait la soumission.
  const periodeValide = champs.typeId && champs.dateDebut && champs.dateFin && champs.dateFin >= champs.dateDebut
    && !(champs.dateDebut === champs.dateFin && champs.debutDemiJournee === 'apres_midi' && champs.finDemiJournee === 'matin');
  const cle = JSON.stringify([corps.typeId, corps.collaborateurId, corps.dateDebut, corps.debutDemiJournee, corps.dateFin, corps.finDemiJournee]);

  useEffect(() => {
    if (!periodeValide || !moi) {
      setApercu(null);
      setErreurApercu('');
      return undefined;
    }
    let abandonne = false;
    const delai = setTimeout(async () => {
      try {
        const resultat = await appeler('/demandes/previsualisation', {
          methode: 'POST',
          corps: { ...corps, collaborateurId, ...(remplace ? { remplaceId: remplace } : {}) },
        });
        if (!abandonne) { setApercu(resultat); setErreurApercu(''); }
      } catch (e) {
        if (!abandonne) { setApercu(null); setErreurApercu(e.message); }
      }
    }, 300);
    return () => { abandonne = true; clearTimeout(delai); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, periodeValide, moi?.id]);

  function changerDebut(e) {
    const dateDebut = e.target.value;
    // Par commodité, la date de fin suit celle de début tant qu'elle n'est pas postérieure.
    setChamps({ ...champs, dateDebut, dateFin: !champs.dateFin || champs.dateFin < dateDebut ? dateDebut : champs.dateFin });
  }

  async function soumettre(evenement) {
    evenement.preventDefault();
    let message;
    const reussi = await envoyer(async () => {
      if (remplace) {
        await appeler(`/demandes/${remplace}/modification`, { methode: 'POST', corps });
        message = "La demande est modifiée : l'ancienne est retirée, la nouvelle est envoyée pour validation.";
        return;
      }
      const demande = await appeler('/demandes', { methode: 'POST', corps: { ...corps, collaborateurId } });
      const qui = pourUnAutre ? `La demande de ${nomComplet(demande.collaborateur)}` : 'Votre demande';
      message = demande.statut === 'en_attente'
        ? `${qui} est envoyée pour validation.`
        : `${pourUnAutre ? `L'absence de ${nomComplet(demande.collaborateur)}` : 'Votre absence'} est enregistrée.`;
    });
    if (reussi) { notifierChangement(); onEnregistre(message); }
  }

  const chargement = !types.donnees || !personnes.donnees;
  return (
    <Dialogue titre={remplace ? 'Modifier la demande' : "Nouvelle demande d'absence"} onFermer={onFermer}>
      {chargement ? (
        <p className={types.erreur || personnes.erreur ? 'message erreur' : 'chargement'}>
          {types.erreur || personnes.erreur || 'Chargement…'}
        </p>
      ) : (
        <form onSubmit={soumettre}>
          {erreur && <p className="message erreur" role="alert">{erreur}</p>}
          {remplace && (
            <p className="aide">La demande en attente sera retirée et remplacée par celle-ci. Les deux restent dans l'historique.</p>
          )}
          {personnes.donnees.length > 1 && !remplace && (
            <>
              <label htmlFor="d-pour">Pour</label>
              <select id="d-pour" value={collaborateurId} onChange={modifier('collaborateurId')}>
                {personnes.donnees.map((p) => (
                  <option key={p.id} value={p.id}>{nomComplet(p)}{p.moi ? ' (moi)' : ''}</option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="d-type">Type d'absence</label>
          <select id="d-type" required value={champs.typeId} onChange={modifier('typeId')}>
            <option value="">Choisir…</option>
            {types.donnees.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}
          </select>

          <div className="ligne-champs">
            <div>
              <label htmlFor="d-debut">Du</label>
              <input id="d-debut" type="date" required value={champs.dateDebut} onChange={changerDebut} />
            </div>
            <div>
              <label htmlFor="d-debut-demi">À partir de</label>
              <select id="d-debut-demi" value={champs.debutDemiJournee} onChange={modifier('debutDemiJournee')}>
                {DEMI_JOURNEES.map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
              </select>
            </div>
          </div>
          <div className="ligne-champs">
            <div>
              <label htmlFor="d-fin">Au</label>
              <input id="d-fin" type="date" required min={champs.dateDebut || undefined} value={champs.dateFin} onChange={modifier('dateFin')} />
            </div>
            <div>
              <label htmlFor="d-fin-demi">Jusqu'à</label>
              <select id="d-fin-demi" value={champs.finDemiJournee} onChange={modifier('finDemiJournee')}>
                {DEMI_JOURNEES.map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle} inclus</option>)}
              </select>
            </div>
          </div>

          <label htmlFor="d-commentaire">Commentaire (facultatif)</label>
          <textarea id="d-commentaire" rows={2} maxLength={1000} value={champs.commentaire} onChange={modifier('commentaire')} />

          <div aria-live="polite" className="apercu">
            {erreurApercu && <p className="message erreur">{erreurApercu}</p>}
            {apercu && (
              <>
                <p className="apercu-duree">
                  <strong>Durée : {formatDuree(apercu.dureeDemiJournees)}</strong>
                  <span> · {apercu.approbationRequise
                    ? `à valider par ${apercu.valideurs.length ? apercu.valideurs.map(nomComplet).join(' ou ') : 'un responsable'}`
                    : 'enregistrée sans validation'}</span>
                </p>
                {apercu.avertissements.map((a, i) => <p key={i} className="message alerte">{a.message}</p>)}
                {apercu.avertissements.length > 0 && <p className="aide">Ces avertissements ne bloquent pas l'envoi.</p>}
                {apercu.blocage && <p className="message erreur" role="alert">{apercu.blocage}</p>}
              </>
            )}
          </div>
          <div className="actions">
            <button className="bouton secondaire" type="button" onClick={onFermer}>Annuler</button>
            <button className="bouton" type="submit" disabled={enCours || Boolean(apercu?.blocage)}>
              {enCours ? 'Envoi…' : remplace ? 'Enregistrer la modification' : apercu && !apercu.approbationRequise ? 'Enregistrer' : 'Envoyer'}
            </button>
          </div>
        </form>
      )}
    </Dialogue>
  );
}
