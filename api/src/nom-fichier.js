// Nom de fichier à télécharger : une version ASCII sûre (`filename`) et le vrai nom en UTF-8 (`filename*`, RFC 6266),
// pour que « Hélène Müller-Çelik » reste lisible dans le navigateur au lieu de « H_l_ne ».
const LIGATURES = { œ: 'oe', Œ: 'OE', æ: 'ae', Æ: 'AE', ß: 'ss', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D' };

export function enteteTelechargement(nom) {
  // Le vrai nom : sans les caractères interdits par les systèmes de fichiers ni les caractères de contrôle.
  const vrai = nom.normalize('NFC').replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'fichier';
  const ascii = vrai.replace(/[œŒæÆßøØłŁđĐ]/g, (c) => LIGATURES[c]).normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/[^\w.-]+/g, '_');
  if (ascii === vrai) return `attachment; filename="${ascii}"`;
  const codé = encodeURIComponent(vrai).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${codé}`;
}
