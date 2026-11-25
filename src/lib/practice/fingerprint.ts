// Picture fingerprints for Find duplicates, worked out in the browser.

import { getImage } from '../db';
import { fingerprintFromPixels, type Fingerprint } from './duplicates';

const cache = new Map<string, Fingerprint | null>();

/** Fingerprint of one stored picture, or null if it can't be read. */
export async function pictureFingerprint(imageId: string): Promise<Fingerprint | null> {
  if (cache.has(imageId)) return cache.get(imageId)!;
  let out: Fingerprint | null = null;
  try {
    const stored = await getImage(imageId);
    if (stored?.data) {
      const bmp = await createImageBitmap(await (await fetch(stored.data)).blob());
      // A smaller copy is plenty and keeps this quick.
      const scale = Math.min(1, 600 / bmp.width);
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const px = ctx.getImageData(0, 0, w, h).data;
      const grey = new Uint8Array(w * h);
      for (let i = 0; i < grey.length; i++) grey[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
      out = fingerprintFromPixels(grey, w, h);
    }
  } catch {
    out = null;
  }
  cache.set(imageId, out);
  return out;
}

/** Fingerprints for many pictures, a few at a time, reporting how far it has got. */
export async function pictureFingerprints(ids: string[], onProgress?: (done: number) => void): Promise<Map<string, Fingerprint>> {
  const out = new Map<string, Fingerprint>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const f = await pictureFingerprint(id);
      if (f) out.set(id, f);
      done++;
      if (done % 20 === 0) onProgress?.(done);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  onProgress?.(done);
  return out;
}
