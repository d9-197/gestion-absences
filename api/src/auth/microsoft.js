// Connexion par compte Microsoft (Entra ID) : OpenID Connect, flux « code d'autorisation » avec PKCE.
import * as oidc from 'openid-client';

export function creerMicrosoft({ emetteur, clientId, clientSecret, appUrl, autoriserHttp = false }) {
  const adresseRetour = `${appUrl}/api/auth/microsoft/retour`;
  let decouverte;

  // La découverte est faite à la première utilisation, pour que l'API démarre même si Microsoft est injoignable.
  function configuration() {
    decouverte ??= oidc
      .discovery(new URL(emetteur), clientId, clientSecret, undefined,
        autoriserHttp ? { execute: [oidc.allowInsecureRequests] } : undefined)
      .catch((erreur) => {
        decouverte = undefined;
        throw erreur;
      });
    return decouverte;
  }

  return {
    // Renvoie l'adresse de connexion Microsoft et les valeurs à vérifier au retour.
    async preparer() {
      const verifications = {
        verifieur: oidc.randomPKCECodeVerifier(),
        etat: oidc.randomState(),
        nonce: oidc.randomNonce(),
      };
      const url = oidc.buildAuthorizationUrl(await configuration(), {
        redirect_uri: adresseRetour,
        scope: 'openid profile email',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifications.verifieur),
        code_challenge_method: 'S256',
        state: verifications.etat,
        nonce: verifications.nonce,
      });
      return { url: url.href, verifications };
    },

    // Échange le code reçu contre un jeton d'identité vérifié et renvoie l'identité Microsoft.
    async terminer(cheminRetour, verifications) {
      // L'adresse de retour est reconstruite sur l'adresse publique : derrière un proxy, l'API ne voit ni le préfixe ni le domaine.
      const retour = new URL(adresseRetour);
      retour.search = new URL(cheminRetour, 'http://x').search;
      const jetons = await oidc.authorizationCodeGrant(await configuration(), retour, {
        pkceCodeVerifier: verifications.verifieur,
        expectedState: verifications.etat,
        expectedNonce: verifications.nonce,
        idTokenExpected: true,
      });
      const identite = jetons.claims();
      return {
        oid: identite.oid ?? identite.sub,
        emails: [identite.email, identite.preferred_username].filter((valeur) => typeof valeur === 'string'),
      };
    },
  };
}
