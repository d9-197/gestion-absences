import { STATUTS } from '../format.js';

// Le statut s'affiche toujours en toutes lettres : la couleur n'est qu'un renfort.
export default function Statut({ statut }) {
  return <span className={`statut statut-${statut}`}>{STATUTS[statut]}</span>;
}
