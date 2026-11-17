// Le cookie de session n'est envoyé par le navigateur qu'en HTTPS (sauf sur localhost).
// Sans réglage explicite, on suit donc l'adresse publique : « Secure » seulement si elle est en HTTPS,
// pour qu'une installation en HTTP ne perde pas silencieusement ses sessions.
export function cookieSecure(appUrl, reglage) {
  if (reglage === 'true') return true;
  if (reglage === 'false') return false;
  return appUrl.startsWith('https://');
}
