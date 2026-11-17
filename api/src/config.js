import { cookieSecure } from './auth/cookie.js';

// Configuration lue dans l'environnement. Une variable obligatoire absente arrête le démarrage.
function requis(nom) {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

function microsoft() {
  const locataire = process.env.MS_TENANT_ID;
  const client = process.env.MS_CLIENT_ID;
  const secret = process.env.MS_CLIENT_SECRET;
  const renseignes = [locataire, client, secret].filter(Boolean).length;
  if (renseignes === 0) return null; // connexion Microsoft désactivée
  if (renseignes < 3) {
    throw new Error('Connexion Microsoft : MS_TENANT_ID, MS_CLIENT_ID et MS_CLIENT_SECRET doivent être définis ensemble');
  }
  return {
    emetteur: `https://login.microsoftonline.com/${locataire}/v2.0`,
    clientId: client,
    clientSecret: secret,
  };
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Adresse publique de l'application, sans barre finale : sert aux liens des e-mails et au retour de Microsoft.
  appUrl: requis('APP_URL').replace(/\/+$/, ''),
  cookieSecure: cookieSecure(requis('APP_URL'), process.env.COOKIE_SECURE),
  // Fuseau de l'entreprise : sert à déterminer « aujourd'hui » (jour d'une demande, délai de prévenance).
  fuseau: process.env.FUSEAU ?? 'Europe/Paris',
  // MODE TEST : connexion sans mot de passe depuis une liste de comptes. À ne jamais activer en production.
  autologin: process.env.AUTOLOGIN_TEST === 'true',
  sessionDureeHeures: Number(process.env.SESSION_DUREE_HEURES ?? 12),
  db: {
    host: requis('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    database: requis('DB_NAME'),
    user: requis('DB_USER'),
    password: requis('DB_PASSWORD'),
    // Sans ces délais, une base injoignable laisse les requêtes en attente indéfiniment.
    connectionTimeoutMillis: 3000,
    query_timeout: 10000,
  },
  smtp: {
    host: requis('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT ?? 25),
    from: requis('SMTP_FROM'),
  },
  microsoft: microsoft(),
};
