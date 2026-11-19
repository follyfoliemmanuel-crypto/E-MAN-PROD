// Photos choisies sur un ordinateur ou un téléphone (jusqu'à 50 Mo) : réduites dans le
// navigateur AVANT l'envoi, pour tenir dans la limite du stockage (10 Mo par image sur
// l'offre gratuite de Cloudinary) sans perte visible sur le site :
//   réalisations et images du site : 2 560 px de large au plus ; photo de profil : 800 px.
// L'orientation des photos de téléphone est respectée. Les images déjà assez légères
// partent telles quelles. Le serveur revérifie ensuite tout (format réel, taille).
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_SIDE = { portfolio: 2560, site_media: 2560, avatar: 800 };
// Image jointe à un devis ou une commande (fichier d'impression), réduite SEULEMENT si elle
// dépasse la limite : très grande définition et haute qualité.
const ATTACHMENT = { side: 6000, quality: 0.92 };
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const shrinksImages = (purpose) => purpose in MAX_SIDE;

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* repli ci-dessous */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, type, quality) => new Promise((ok) => canvas.toBlob(ok, type, quality));

/** Renvoie le fichier à envoyer (le même, ou une version réduite) ; erreur claire sinon. */
export async function prepareImage(file, purpose, maxBytes) {
  const attachment = purpose === 'attachment';
  if ((!attachment && !shrinksImages(purpose)) || !IMAGE_TYPES.includes(file.type)) return file;
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Photo trop lourde : 50 Mo maximum.');
  let bmp;
  try {
    bmp = await decode(file);
  } catch {
    throw new Error('Cette image ne peut pas être lue. Enregistrez-la en JPG ou PNG, puis réessayez.');
  }
  const w0 = bmp.width;
  const h0 = bmp.height;
  const side = attachment ? ATTACHMENT.side : MAX_SIDE[purpose];
  if (file.size <= maxBytes && Math.max(w0, h0) <= side) { bmp.close?.(); return file; }

  // PNG ou WebP avec transparence : WebP (garde la transparence) ; sinon JPEG.
  const keepAlpha = file.type !== 'image/jpeg';
  const type = keepAlpha ? 'image/webp' : 'image/jpeg';
  let scale = Math.min(1, side / Math.max(w0, h0));
  let quality = attachment ? ATTACHMENT.quality : 0.88;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.size <= maxBytes) {
      bmp.close?.();
      const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
      return new File([blob], `${base}.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type, lastModified: Date.now() });
    }
    // Encore trop lourd : on baisse d'abord la qualité, puis la taille.
    if (quality > 0.72) quality -= 0.08;
    else scale *= 0.8;
  }
  bmp.close?.();
  throw new Error('Impossible de réduire cette photo sous la limite. Essayez une autre photo.');
}
