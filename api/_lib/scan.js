// Inspection du CONTENU des fichiers envoyés, après réception et avant qu'ils soient utilisables.
//
// Objectif : bloquer les pièges courants cachés dans des fichiers d'apparence normale :
//   - photo « double » (vraie image + programme ou script caché dedans ou collé à la fin) ;
//   - archive ZIP contenant un programme, une double extension, une autre archive, un chemin
//     piégé (« ../ »), un contenu chiffré impossible à vérifier, ou une « bombe » de décompression ;
//   - documents Office avec macros ou objets intégrés ;
//   - PDF / Illustrator avec JavaScript, lancement de programme, fichiers joints ou contenu actif
//     (y compris caché dans des flux compressés ou avec des noms encodés « /J#61vaScript ») ;
//   - PostScript (EPS, ancien AI) avec des commandes qui touchent aux fichiers ou au système.
//
// Ce n'est pas un antivirus : un logiciel malveillant inconnu, bien caché, peut passer. C'est un
// filtre de structure, gratuit, qui s'ajoute aux contrôles de format, de taille et de signature.
import { inflateSync, inflateRawSync } from 'node:zlib';

const latin = (buf) => buf.toString('latin1');

/** Marques de code exécutable ou de script qui n'ont rien à faire dans une image ou un document. */
const PAYLOAD_MARKERS = [
  ['<?php', 'code PHP'], ['<?=', 'code PHP'], ['<script', 'script web'], ['javascript:', 'script web'],
  ['This program cannot be run in DOS mode', 'programme Windows'], ['WScript.Shell', 'script Windows'],
  ['powershell', 'commande PowerShell'], ['cmd.exe', 'commande Windows'], ['#!/bin/sh', 'script système'],
  ['#!/bin/bash', 'script système'], ['eval(base64_decode', 'code PHP masqué'], ['<%@', 'code serveur'],
];
/**
 * binary : données compressées (photos, flux PDF). Une marque très courte (« <?= ») y apparaît
 * par hasard dans les gros fichiers ; on n'y cherche donc que les marques d'au moins 5 caractères.
 */
function findPayload(text, { binary = true } = {}) {
  const low = text.toLowerCase();
  for (const [m, what] of PAYLOAD_MARKERS) if ((!binary || m.length >= 5) && low.includes(m.toLowerCase())) return what;
  return null;
}

/** Signatures de fichiers qui ne doivent pas se trouver collées APRÈS la fin d'une image. */
const TRAILING_SIGNATURES = [
  [Buffer.from('PK\x03\x04', 'latin1'), 'une archive ZIP'], [Buffer.from('MZ', 'latin1'), 'un programme Windows'],
  [Buffer.from('\x7fELF', 'latin1'), 'un programme Linux'], [Buffer.from('%PDF', 'latin1'), 'un document PDF'],
  [Buffer.from('Rar!', 'latin1'), 'une archive RAR'], [Buffer.from('7z\xbc\xaf', 'latin1'), 'une archive 7z'],
];

// --- Images --------------------------------------------------------------------------------------
/** Vraie fin de l'image, en suivant sa structure (et non la dernière marque trouvée, facile à piéger). */
function imageEnd(buf, format) {
  try {
    if (format === 'jpg') {
      let p = 2;
      while (p + 4 <= buf.length) {
        if (buf[p] !== 0xff) return buf.length;
        const marker = buf[p + 1];
        if (marker === 0xff) { p++; continue; }
        if (marker === 0xd9) return p + 2;
        if (marker === 0xda) break; // début des données d'image
        p += 2 + buf.readUInt16BE(p + 2); // segment (EXIF, miniature, commentaire…) sauté en entier
      }
      // Données compressées : un 0xFF y est toujours suivi de 0x00, d'un marqueur RSTn ou d'un autre segment.
      for (let i = p; i + 1 < buf.length; i++) if (buf[i] === 0xff && buf[i + 1] === 0xd9) return i + 2;
      return buf.length;
    }
    if (format === 'png') {
      let p = 8;
      while (p + 12 <= buf.length) {
        const len = buf.readUInt32BE(p);
        const type = buf.toString('latin1', p + 4, p + 8);
        p += 12 + len;
        if (type === 'IEND') return p;
      }
      return buf.length;
    }
    if (format === 'webp') return Math.min(buf.length, 8 + buf.readUInt32LE(4));
  } catch { /* structure incohérente : on garde tout le fichier */ }
  return buf.length;
}
function scanImage(buf, format) {
  const end = imageEnd(buf, format);
  const tail = buf.subarray(end);
  if (tail.length > 16) {
    for (const [sig, what] of TRAILING_SIGNATURES) {
      const at = tail.indexOf(sig);
      // « MZ » est court : on n'y croit que suivi de l'en-tête Windows habituel.
      if (at >= 0 && (sig.length > 2 || latin(tail.subarray(at, at + 512)).includes('This program'))) return `l’image cache ${what} après sa fin`;
    }
  }
  const what = findPayload(latin(buf));
  return what ? `l’image contient du ${what}` : null;
}

// --- ZIP (et formats bâtis sur ZIP : Word, Excel, PowerPoint, CorelDRAW récent) -------------------
const DANGEROUS_EXT = /\.(exe|com|scr|pif|bat|cmd|msi|msp|dll|cpl|sys|lnk|url|reg|vbs|vbe|js|jse|mjs|wsf|wsh|hta|ps1|psm1|jar|apk|app|sh|bash|py|pl|rb|php\d?|phtml|asp|aspx|jsp|cgi|html?|xhtml|svg|chm|iso|img|vhd|vhdx|docm|xlsm|pptm|dotm|xltm|xlam|ppam|one|inf|gadget|msc|application|appref-ms|library-ms|scf|xll)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|cab|arj|lz|lzh|zst)$/i;
const MAX_ENTRIES = 2000;
const MAX_TOTAL = 500 * 1024 * 1024; // 500 Mo une fois décompressé
const MAX_RATIO = 100; // un fichier ne grossit jamais 100 fois… sauf une « bombe »

export function zipEntries(buf) {
  // Fin du répertoire central : dans les 65 557 derniers octets.
  const from = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('archive illisible');
  const count = buf.readUInt16LE(eocd + 10);
  const size = buf.readUInt32LE(eocd + 12);
  const offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('format ZIP64 non accepté');
  if (offset + size > buf.length) throw new Error('archive tronquée');
  const out = [];
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('répertoire de l’archive invalide');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    out.push({ name, flags, method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
/** Contenu d'une entrée (petites entrées seulement : macros, relations Office). */
function zipRead(buf, e, limit = 2 * 1024 * 1024) {
  if (e.usize > limit) return null;
  const p = e.local;
  if (buf.readUInt32LE(p) !== 0x04034b50) return null;
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + e.csize);
  try { return e.method === 0 ? data : e.method === 8 ? inflateRawSync(data, { maxOutputLength: limit }) : null; } catch { return null; }
}

function scanZip(buf, format) {
  let entries;
  try { entries = zipEntries(buf); } catch (err) { return `archive invalide (${err.message})`; }
  if (entries.length > MAX_ENTRIES) return `l’archive contient trop de fichiers (${entries.length})`;
  let total = 0;
  const office = ['docx', 'xlsx', 'pptx'].includes(format);
  for (const e of entries) {
    const name = e.name.replace(/\\/g, '/');
    const base = name.split('/').pop();
    if (e.flags & 0x1) return 'l’archive est protégée par un mot de passe (son contenu ne peut pas être vérifié)';
    if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) return `chemin piégé dans l’archive (« ${name.slice(0, 80)} »)`;
    if (DANGEROUS_EXT.test(base)) return `l’archive contient un fichier interdit (« ${base.slice(0, 80)} »)`;
    if (/\.[a-z0-9]{2,4}\.[a-z0-9]{2,5}$/i.test(base) && DANGEROUS_EXT.test(base.replace(/\.[a-z0-9]+$/i, '')) ) return `double extension trompeuse (« ${base.slice(0, 80)} »)`;
    if (!office && ARCHIVE_EXT.test(base)) return `l’archive contient une autre archive (« ${base.slice(0, 80)} »)`;
    if (office && (/vbaProject\.bin$/i.test(name) || /\/activeX\//i.test(name) || /\/embeddings\/.*\.(bin|exe|ole)$/i.test(name))) {
      return 'le document contient des macros ou des objets intégrés (non acceptés)';
    }
    total += e.usize;
    if (total > MAX_TOTAL) return 'l’archive est beaucoup trop grosse une fois décompressée';
    if (e.usize > 1024 * 1024 && e.csize > 0 && e.usize / e.csize > MAX_RATIO) return 'archive anormale (« bombe » de décompression)';
  }
  if (office) {
    // Les relations Office ne doivent pas pointer vers un contenu extérieur exécutable ou distant.
    for (const e of entries.filter((x) => /\.rels$/i.test(x.name))) {
      const t = zipRead(buf, e)?.toString('utf8') || '';
      for (const rel of t.match(/<Relationship\b[^>]*>/gi) || []) {
        const target = (rel.match(/\bTarget="([^"]*)"/i) || [])[1] || '';
        const external = /\bTargetMode="External"/i.test(rel);
        // Lien externe autorisé : page web ou e-mail. Jamais un fichier local, un partage réseau ou un modèle distant.
        if (external && !/^(https?:\/\/|mailto:)/i.test(target)) return 'le document charge un contenu extérieur suspect';
        if (external && /attachedTemplate|oleObject|frame/i.test(rel)) return 'le document charge un modèle ou un objet extérieur';
        if (/\.(exe|dll|hta|js|vbs|ps1|bat|cmd|scr|lnk)$/i.test(target)) return 'le document pointe vers un programme';
      }
    }
  }
  return null;
}

// --- PDF (et Illustrator compatible PDF) ---------------------------------------------------------
/** « /J#61vaScript » → « /JavaScript » : les noms PDF peuvent être encodés pour échapper aux filtres. */
const decodeNames = (t) => t.replace(/\/[^\s/<>[\]()]*#[0-9a-fA-F]{2}[^\s/<>[\]()]*/g, (n) => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
const PDF_ACTIVE = [
  [/\/JavaScript\b/, 'du JavaScript'], [/\/JS\b/, 'du JavaScript'], [/\/Launch\b/, 'une commande de lancement de programme'],
  [/\/EmbeddedFiles?\b/, 'des fichiers cachés à l’intérieur'], [/\/RichMedia\b/, 'du contenu actif (Flash ou multimédia)'],
  [/\/ImportData\b/, 'une importation de données'], [/\/SubmitForm\b/, 'un envoi automatique de données'], [/\/GoToE\b/, 'un lien vers un fichier intégré'],
];
const textual = (b) => { const n = Math.min(b.length, 4096); let ok = 0; for (let i = 0; i < n; i++) { const c = b[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++; } return n > 0 && ok / n > 0.9; };
function scanPdf(buf) {
  const text = latin(buf);
  // Partie « structure » du PDF : le contenu brut des flux (photos compressées…) est masqué, pour
  // ne pas prendre un hasard binaire pour une commande.
  const parts = [text.replace(/stream\r?\n[\s\S]*?endstream/g, 'stream endstream')];
  let budget = 64 * 1024 * 1024;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text)) && budget > 0) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const chunk = buf.subarray(start, end);
    try {
      const out = inflateSync(chunk, { maxOutputLength: Math.min(budget, 16 * 1024 * 1024) });
      budget -= out.length;
      if (textual(out)) parts.push(latin(out)); // objets et pages ; les pixels d'images sont ignorés
    } catch { /* flux non compressé ou autre filtre : déjà lu tel quel */ }
    re.lastIndex = end + 9;
  }
  for (const part of parts) {
    const t = decodeNames(part);
    for (const [rx, what] of PDF_ACTIVE) if (rx.test(t)) return `le PDF contient ${what}`;
  }
  const what = findPayload(text);
  return what ? `le fichier contient du ${what}` : null;
}

// --- PostScript (EPS, ancien Illustrator) --------------------------------------------------------
const PS_DANGEROUS = [
  [/%pipe%/i, 'une commande système'], [/\(\s*%(os|pipe|ram|disk\d*)%/i, 'un accès aux fichiers du système'],
  [/\.forceput\b/, 'une commande interne interdite'], [/\bputdeviceprops\b/, 'un changement de périphérique'],
  [/\bdeletefile\b/, 'une suppression de fichier'], [/\brenamefile\b/, 'un renommage de fichier'],
  [/\/OutputFile\b/, 'une écriture de fichier'], [/\bsetfileparameters\b/, 'un changement d’accès aux fichiers'],
  [/\.libfile\b/, 'un chargement de bibliothèque'], [/\bfilenameforall\b/, 'une liste de fichiers du système'],
];
function scanPostScript(buf) {
  let t = latin(buf);
  // EPS « binaire » (en-tête DOS) : la partie PostScript est indiquée dans l'en-tête.
  if (buf.length > 30 && buf.readUInt32BE(0) === 0xc5d0d3c6) {
    const off = buf.readUInt32LE(4); const len = buf.readUInt32LE(8);
    t = latin(buf.subarray(off, off + len));
  }
  for (const [rx, what] of PS_DANGEROUS) if (rx.test(t)) return `le fichier PostScript contient ${what}`;
  const what = findPayload(t);
  return what ? `le fichier contient du ${what}` : null;
}

/**
 * @param {Buffer} buf  contenu complet du fichier
 * @param {string} format  clé de FORMATS (jpg, png, webp, pdf, ai, eps, psd, cdr, zip, docx, xlsx, pptx)
 * @returns {string|null}  raison du refus, ou null si rien de suspect
 */
export function scanContent(buf, format) {
  if (!Buffer.isBuffer(buf) || !buf.length) return 'fichier vide';
  const isZip = buf.readUInt32LE(0) === 0x04034b50;
  switch (format) {
    case 'jpg': case 'png': case 'webp': return scanImage(buf, format);
    case 'pdf': return scanPdf(buf);
    case 'ai': return latin(buf.subarray(0, 5)) === '%PDF-' ? scanPdf(buf) : scanPostScript(buf);
    case 'eps': return scanPostScript(buf);
    case 'zip': case 'docx': case 'xlsx': case 'pptx': return scanZip(buf, format);
    case 'cdr': return isZip ? scanZip(buf, 'cdr') : (findPayload(latin(buf)) ? 'le fichier contient du code caché' : null);
    case 'psd': case 'webm': case 'ogg': case 'm4a': { const what = findPayload(latin(buf)); return what ? `le fichier contient du ${what}` : null; }
    default: return null;
  }
}
