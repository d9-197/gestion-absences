import { inflateSync } from 'node:zlib';

// Relit le texte d'un PDF produit par pdfkit : décompresse les flux, puis lit les chaînes hexadécimales des
// instructions TJ (polices standard, codage WinAnsi : les accents du latin-1 sont conservés).
export function texteDuPdf(tampon) {
  const brut = tampon.toString('latin1');
  const lignes = [];
  for (const flux of brut.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let contenu;
    try {
      contenu = inflateSync(Buffer.from(flux[1], 'latin1')).toString('latin1');
    } catch {
      contenu = flux[1];
    }
    for (const tj of contenu.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lignes.push([...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
    }
  }
  return lignes.join('\n');
}

export const nombreDePages = (tampon) => (tampon.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
