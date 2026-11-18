import { RELANCE_JOURS_MAX, lireReglagesNotification } from '../emails/resume.js';

// Réglage des e-mails « à traiter » et des relances (voir emails/resume.js).
export async function routesAdminNotifications(app, { pool }) {
  const etat = async () => ({ ...(await lireReglagesNotification(pool)), relanceJoursMax: RELANCE_JOURS_MAX });

  app.get('/notifications', etat);

  app.put('/notifications', {
    schema: {
      body: {
        type: 'object', required: ['mode', 'relanceJours'], additionalProperties: false,
        properties: {
          mode: { enum: ['immediat', 'quotidien'] },
          relanceJours: { type: 'integer', minimum: 0, maximum: RELANCE_JOURS_MAX },
        },
      },
    },
  }, async (requete) => {
    const { mode, relanceJours } = requete.body;
    await pool.query(
      `INSERT INTO parametres (cle, valeur) VALUES ('notification_a_traiter', $1::jsonb), ('relance_jours', $2::jsonb)
       ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_le = now()`,
      [JSON.stringify(mode), JSON.stringify(relanceJours)],
    );
    return etat();
  });
}
