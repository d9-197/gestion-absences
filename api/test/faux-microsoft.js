// Faux fournisseur OpenID Connect pour tester la connexion Microsoft sans Internet.
// Il vérifie le défi PKCE et signe de vrais jetons d'identité.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

export async function demarrerFauxMicrosoft({ clientId }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'cle-test', alg: 'RS256', use: 'sig' };
  const codes = new Map(); // code -> { identite, nonce, defi }
  let emetteur;

  const serveur = createServer(async (requete, reponse) => {
    const url = new URL(requete.url, emetteur);
    const json = (statut, corps) => {
      reponse.writeHead(statut, { 'content-type': 'application/json' });
      reponse.end(JSON.stringify(corps));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: emetteur,
        authorization_endpoint: `${emetteur}/authorize`,
        token_endpoint: `${emetteur}/token`,
        jwks_uri: `${emetteur}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && requete.method === 'POST') {
      let corps = '';
      for await (const morceau of requete) corps += morceau;
      const parametres = new URLSearchParams(corps);
      const emis = codes.get(parametres.get('code'));
      codes.delete(parametres.get('code'));
      const defi = createHash('sha256').update(parametres.get('code_verifier') ?? '').digest('base64url');
      if (!emis || defi !== emis.defi) return json(400, { error: 'invalid_grant' });
      const idToken = await new SignJWT({ ...emis.identite, nonce: emis.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(emetteur).setAudience(clientId).setSubject(emis.identite.sub ?? 'sujet')
        .setIssuedAt().setExpirationTime('5m')
        .sign(privateKey);
      return json(200, { access_token: 'acces', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    return json(404, {});
  });
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  emetteur = `http://127.0.0.1:${serveur.address().port}`;

  return {
    emetteur,
    // Simule la personne qui s'identifie chez Microsoft : renvoie les paramètres du retour vers l'application.
    autoriser(adresseAutorisation, identite) {
      const demande = new URL(adresseAutorisation);
      const code = `code-${codes.size}-${Date.now()}`;
      codes.set(code, {
        identite,
        nonce: demande.searchParams.get('nonce'),
        defi: demande.searchParams.get('code_challenge'),
      });
      return { code, state: demande.searchParams.get('state'), demande };
    },
    arreter: () => new Promise((resoudre) => serveur.close(resoudre)),
  };
}
