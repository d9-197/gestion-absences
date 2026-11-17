import nodemailer from 'nodemailer';

// Envoi des e-mails par le serveur SMTP. Les pièces jointes sont facultatives : [{ filename, content, contentType }].
export function creerCourriel({ host, port, from, user, password, secure = false, verifierCertificat = true }) {
  const transport = nodemailer.createTransport({
    host,
    port,
    // secure : TLS dès la connexion (port 465). Sinon la connexion passe en STARTTLS si le serveur le propose.
    secure,
    ...(user ? { auth: { user, pass: password } } : {}),
    tls: { rejectUnauthorized: verifierCertificat },
    // Sans ces délais, un serveur qui ne répond pas bloquerait l'envoi indéfiniment.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
  return {
    envoyer: ({ a, sujet, texte, pieces }) => transport.sendMail({ from, to: a, subject: sujet, text: texte, attachments: pieces }),
  };
}
