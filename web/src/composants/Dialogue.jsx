import { useEffect, useRef } from 'react';

// Fenêtre modale basée sur l'élément <dialog> : gestion du focus et de la touche Échap par le navigateur.
export default function Dialogue({ titre, onFermer, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue.open) dialogue.showModal();
    return () => dialogue.close();
  }, []);
  return (
    <dialog ref={ref} className="dialogue" aria-labelledby="titre-dialogue"
      onCancel={(evenement) => { evenement.preventDefault(); onFermer(); }}>
      <h2 id="titre-dialogue">{titre}</h2>
      {children}
    </dialog>
  );
}

// Pied de formulaire commun : annuler et enregistrer.
export function ActionsDialogue({ onFermer, enCours, libelle = 'Enregistrer' }) {
  return (
    <div className="actions">
      <button className="bouton secondaire" type="button" onClick={onFermer}>Annuler</button>
      <button className="bouton" type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : libelle}</button>
    </div>
  );
}
