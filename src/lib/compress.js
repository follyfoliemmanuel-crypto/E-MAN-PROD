// Compression automatique des fichiers envoyés, dans le navigateur, AVANT Cloudinary.
//
// Principe : un fichier qui tient déjà dans la limite part tel quel, identique à l'octet
// près (c'est souvent un fichier d'impression). Seul un fichier trop lourd est compressé :
//   - photo (JPG, PNG, WebP) : réenregistrée en haute qualité (jusqu'à 6 000 px, qualité
//     92 %), largement suffisant pour l'impression grand format courante ;
//   - autre fichier (PSD, EPS, AI, PDF…) : mis dans une archive .zip, SANS PERTE (le fichier
//     d'origine est retrouvé intact en ouvrant l'archive). Les fichiers d'atelier non
//     compressés (PSD, EPS…) y perdent souvent la moitié de leur poids.
// Rien n'est installé : le navigateur sait compresser (CompressionStream « deflate-raw »).
// Le serveur revérifie ensuite le fichier reçu (format réel, taille).
import { prepareImage } from './images.js';

export const MAX_PICK_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MB = (n) => `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`;

// --- ZIP minimal (une seule entrée, méthode « deflate ») ------------------------------
let crcTable = null;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Archive .zip contenant le fichier d'origine, intact. */
export async function zipFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const packed = await deflateRaw(data);
  const name = new TextEncoder().encode(file.name || 'fichier');
  const crc = crc32(data);
  const { time, date } = dosDateTime(new Date(file.lastModified || Date.now()));
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8
  local.setUint16(8, 8, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
  local.setUint32(14, crc, true); local.setUint32(18, packed.length, true); local.setUint32(22, data.length, true);
  local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
  central.setUint16(8, 0x0800, true); central.setUint16(10, 8, true); central.setUint16(12, time, true); central.setUint16(14, date, true);
  central.setUint32(16, crc, true); central.setUint32(20, packed.length, true); central.setUint32(24, data.length, true);
  central.setUint16(28, name.length, true); central.setUint32(42, 0, true);
  const centralOffset = 30 + name.length + packed.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + name.length, true); end.setUint32(16, centralOffset, true);
  const base = (file.name || 'fichier').replace(/\.[^.]+$/, '');
  return new File([local, name, packed, central, name, end], `${base}.zip`, { type: 'application/zip', lastModified: Date.now() });
}

/**
 * Fichier à envoyer pour un usage donné : l'original s'il tient dans la limite, sinon une
 * version compressée. `limit` = { max_bytes, formats } renvoyé par le serveur.
 */
export async function compressForUpload(file, limit, onStep = () => {}) {
  const max = limit?.max_bytes;
  if (!max || file.size <= max) return file;
  if (file.size > MAX_PICK_BYTES) throw new Error(`Fichier trop lourd (${MB(file.size)}) : 50 Mo maximum, ou envoyez-le sur WhatsApp.`);
  const formats = limit.formats || [];
  if (IMAGE_TYPES.includes(file.type) && formats.some((f) => ['jpg', 'png', 'webp'].includes(f))) {
    onStep('Compression de la photo…');
    return prepareImage(file, 'attachment', max);
  }
  if (!formats.includes('zip') || typeof CompressionStream === 'undefined') {
    throw new Error(`Fichier trop lourd (${MB(file.size)}) : ${MB(max)} maximum. Envoyez-le sur WhatsApp.`);
  }
  onStep('Compression du fichier…');
  const zipped = await zipFile(file);
  if (zipped.size > max) {
    throw new Error(`Même compressé, ce fichier fait ${MB(zipped.size)} (${MB(max)} maximum). Envoyez-le sur WhatsApp ou par un lien de partage (WeTransfer, Google Drive).`);
  }
  return zipped;
}
