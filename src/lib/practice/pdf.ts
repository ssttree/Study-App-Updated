// Opens PDFs in the browser with PDF.js, reads their text positions and
// cuts questions and solutions out of the pages as pictures. PDF.js is big,
// so this file is only loaded once a PDF is picked.

import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { findBars, trimBox, type Box, type Pixels } from './crop';
import type { PageText, Region } from './smartered';

// Vite bundles the worker as its own .js file. A plain .mjs link broke on the
// live site, and browsers that cached that bad copy never asked for it again.
GlobalWorkerOptions.workerPort = new PdfWorker();

/** Pages are drawn at twice their PDF size, so the crops stay sharp. */
export const SCALE = 2;

export interface Picture {
  data: string;
  width: number;
  height: number;
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  pixels: Pixels;
  bars: boolean[];
}

export class OpenPdf {
  private rendered = new Map<number, Promise<RenderedPage>>();

  private constructor(
    readonly doc: PDFDocumentProxy,
    readonly name: string,
  ) {}

  static async open(file: File): Promise<OpenPdf> {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await getDocument({ data }).promise;
    return new OpenPdf(doc, file.name);
  }

  get pageCount(): number {
    return this.doc.numPages;
  }

  /** Text positions on every page, for finding the questions. */
  async text(): Promise<PageText[]> {
    const pages: PageText[] = [];
    for (let n = 1; n <= this.doc.numPages; n++) {
      const page = await this.doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const [, b, c, , e, f] = it.transform as number[];
        items.push({ str: it.str, x: e, y: f, w: it.width, h: it.height, rotated: b !== 0 || c !== 0 });
      }
      pages.push({ width: viewport.width, height: viewport.height, items });
    }
    return pages;
  }

  /** Draws one page (0 based) at SCALE. Pages are kept so each is drawn once. */
  page(index: number): Promise<RenderedPage> {
    let p = this.rendered.get(index);
    if (!p) {
      p = this.draw(index);
      this.rendered.set(index, p);
    }
    return p;
  }

  private async draw(index: number): Promise<RenderedPage> {
    const page = await this.doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = { data: image.data, width: image.width, height: image.height };
    return { canvas, pixels, bars: findBars(pixels) };
  }

  /** Crops the given PDF-unit regions, trims them and stacks them into one picture. */
  async crop(regions: Region[], trim = true): Promise<Picture | null> {
    const parts: { canvas: HTMLCanvasElement; box: Box }[] = [];
    for (const r of regions) {
      const page = await this.page(r.page);
      const box: Box = { x0: r.x0 * SCALE, y0: r.top * SCALE, x1: r.x1 * SCALE, y1: r.bottom * SCALE };
      const trimmed = trim ? trimBox(page.pixels, box, page.bars) : box;
      if (trimmed && trimmed.x1 - trimmed.x0 > 2 && trimmed.y1 - trimmed.y0 > 2) parts.push({ canvas: page.canvas, box: trimmed });
    }
    return stack(parts);
  }

  /** A page as a picture, for drawing boxes on by hand. */
  async pageImage(index: number): Promise<{ url: string; width: number; height: number }> {
    const page = await this.page(index);
    return { url: page.canvas.toDataURL('image/png'), width: page.canvas.width / SCALE, height: page.canvas.height / SCALE };
  }

  destroy(): void {
    this.rendered.clear();
    void this.doc.loadingTask.destroy();
  }
}

const GAP = 16;

function stack(parts: { canvas: HTMLCanvasElement; box: Box }[]): Picture | null {
  if (!parts.length) return null;
  const width = Math.max(...parts.map((p) => p.box.x1 - p.box.x0));
  const height = parts.reduce((sum, p) => sum + p.box.y1 - p.box.y0, 0) + GAP * (parts.length - 1);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const { canvas, box } of parts) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    ctx.drawImage(canvas, box.x0, box.y0, w, h, 0, y, w, h);
    y += h + GAP;
  }
  return { data: out.toDataURL('image/png'), width, height };
}
