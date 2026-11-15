import { useEffect, useState } from 'react';

// Page provisoire : vérifie que l'interface joint bien l'API et la base.
export default function App() {
  const [etat, setEtat] = useState('vérification…');

  useEffect(() => {
    fetch('/api/health')
      .then((reponse) => reponse.json())
      .then((corps) => setEtat(corps.statut === 'ok' ? 'API et base joignables' : 'base injoignable'))
      .catch(() => setEtat('API injoignable'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '3rem auto', maxWidth: '40rem', padding: '0 1rem' }}>
      <h1>Gestion des absences</h1>
      <p>État des services : {etat}</p>
    </main>
  );
}
