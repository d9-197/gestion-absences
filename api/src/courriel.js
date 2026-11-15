import nodemailer from 'nodemailer';

// Envoi des e-mails par le serveur SMTP interne.
export function creerCourriel({ host, port, from }) {
  const transport = nodemailer.createTransport({ host, port, secure: false });
  return {
    envoyer: ({ a, sujet, texte }) => transport.sendMail({ from, to: a, subject: sujet, text: texte }),
  };
}
