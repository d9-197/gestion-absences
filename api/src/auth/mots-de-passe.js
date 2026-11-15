// Hachage des mots de passe avec scrypt (module crypto de Node, sans dépendance).
// Format stocké : scrypt$N$r$p$sel$empreinte, pour pouvoir durcir les paramètres plus tard.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const N = 2 ** 15;
const R = 8;
const P = 1;
const LONGUEUR = 32;

export const LONGUEUR_MINIMALE = 12;

const deriver = (motDePasse, sel, n, r, p, longueur) =>
  scryptAsync(motDePasse, sel, longueur, { N: n, r, p, maxmem: 256 * n * r });

export async function hacher(motDePasse) {
  const sel = randomBytes(16);
  const empreinte = await deriver(motDePasse, sel, N, R, P, LONGUEUR);
  return ['scrypt', N, R, P, sel.toString('base64'), empreinte.toString('base64')].join('$');
}

export async function verifier(motDePasse, stocke) {
  const [algo, n, r, p, sel, empreinte] = String(stocke).split('$');
  if (algo !== 'scrypt' || !empreinte) return false;
  const attendu = Buffer.from(empreinte, 'base64');
  const obtenu = await deriver(motDePasse, Buffer.from(sel, 'base64'), Number(n), Number(r), Number(p), attendu.length);
  return timingSafeEqual(attendu, obtenu);
}
