// Picture fingerprints for Find duplicates, worked out in the browser.
// The blank margin is cut off first, so two crops of the same question with
// a bit more or less white space around them still match.

import { getImage } from '../db';
import { fingerprintFromGrey, GRID_H, GRID_W, type Fingerprint } from './duplicates';

const cache = new Map<string, Fingerprint | null>();

function canvas(w: number, h: number): { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    return { ctx: new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })! };
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { ctx: c.getContext('2d', { willReadFrequently: true })! };
}

async function decode(data: string): Promise<ImageBitmap> {
  const blob = await (await fetch(data)).blob();
  return createImageBitmap(blob);
}

/** Fingerprint of one stored picture, or null if it can't be read. */
export async function pictureFingerprint(imageId: string): Promise<Fingerprint | null> {
  if (cache.has(imageId)) return cache.get(imageId)!;
  let out: Fingerprint | null = null;
  try {
    const stored = await getImage(imageId);
    if (stored?.data) {
      const bmp = await decode(stored.data);
      // Find the inked part on a smaller copy.
      const scale = Math.min(1, 600 / bmp.width);
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const { ctx } = canvas(w, h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 200) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < x0) {
        x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1;
      }
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      const gw = GRID_W + 1;
      const small = canvas(gw, GRID_H).ctx;
      small.imageSmoothingQuality = 'high';
      small.fillStyle = '#fff';
      small.fillRect(0, 0, gw, GRID_H);
      small.drawImage(bmp, x0 / scale, y0 / scale, bw / scale, bh / scale, 0, 0, gw, GRID_H);
      const sp = small.getImageData(0, 0, gw, GRID_H).data;
      const grey = new Float32Array(gw * GRID_H);
      for (let i = 0; i < grey.length; i++) grey[i] = sp[i * 4] * 0.299 + sp[i * 4 + 1] * 0.587 + sp[i * 4 + 2] * 0.114;
      out = fingerprintFromGrey(grey, bw / bh);
      bmp.close();
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
