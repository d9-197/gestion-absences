// Configuration lue dans l'environnement. Une variable obligatoire absente arrête le démarrage.
function requis(nom) {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
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
};
