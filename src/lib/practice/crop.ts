// Tidies the boxes found by smartered.ts using the page's pixels: cuts off
// the grey side bars SmarterEd prints beside worked solutions, the blank
// space and the ruled line under each question, and the empty answer lines
// at the bottom of chemistry questions. Works on raw RGBA pixels so it can
// be tested without a browser.

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const INK = 205;

function lum(p: Pixels, x: number, y: number): number {
  const i = (y * p.width + x) * 4;
  return (p.data[i] * 299 + p.data[i + 1] * 587 + p.data[i + 2] * 114) / 1000;
}

/**
 * Pixel columns that belong to a solid grey bar: a long unbroken run of the
 * same mid grey. Text, graphs and axes never make runs this long.
 */
export function findBars(p: Pixels, minRun = Math.round(p.height * 0.15)): boolean[] {
  const bars = new Array<boolean>(p.width).fill(false);
  for (let x = 0; x < p.width; x++) {
    let run = 0;
    let start = -1;
    for (let y = 0; y < p.height; y++) {
      const v = lum(p, x, y);
      if (v > 60 && v < 235 && run > 0 && Math.abs(v - start) <= 10) {
        run++;
      } else if (v > 60 && v < 235) {
        run = 1;
        start = v;
      } else {
        run = 0;
      }
      if (run >= minRun) {
        bars[x] = true;
        break;
      }
    }
  }
  return bars;
}

/** Shrinks a box to the ink inside it. Returns null if there is nothing there. */
export function trimBox(p: Pixels, box: Box, bars: boolean[], pad = 12): Box | null {
  let { x0, y0, x1, y1 } = clampBox(p, box);
  // Stop at the first grey bar past the left part of the box.
  for (let x = Math.round(x0 + (x1 - x0) * 0.3); x < x1; x++) {
    if (bars[x]) {
      x1 = Math.max(x0 + 1, x - 6);
      break;
    }
  }
  const w = x1 - x0;
  const rowInk = new Array<number>(y1 - y0).fill(0);
  const rowSpan: [number, number][] = [];
  for (let y = y0; y < y1; y++) {
    let count = 0;
    let first = -1;
    let last = -1;
    for (let x = x0; x < x1; x++) {
      if (lum(p, x, y) < INK) {
        count++;
        if (first < 0) first = x;
        last = x;
      }
    }
    rowInk[y - y0] = count;
    rowSpan.push([first, last]);
  }

  // Bands of rows with ink, top to bottom.
  const bands: { from: number; to: number }[] = [];
  for (let i = 0; i < rowInk.length; i++) {
    if (rowInk[i] === 0) continue;
    const last = bands[bands.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else bands.push({ from: i, to: i });
  }
  // A thin band that runs most of the way across is a ruled or answer line.
  const isLine = (b: { from: number; to: number }) => {
    if (b.to - b.from > 4) return false;
    let first = Infinity;
    let last = -1;
    for (let i = b.from; i <= b.to; i++) {
      const [f, l] = rowSpan[i];
      if (f >= 0) {
        first = Math.min(first, f);
        last = Math.max(last, l);
      }
    }
    return last - first > w * 0.6;
  };
  while (bands.length && isLine(bands[bands.length - 1])) bands.pop();
  while (bands.length && isLine(bands[0])) bands.shift();
  if (!bands.length) return null;
  const top = y0 + bands[0].from;
  const bottom = y0 + bands[bands.length - 1].to + 1;

  let left = x1;
  let right = x0;
  for (let y = top; y < bottom; y++) {
    const [f, l] = rowSpan[y - y0];
    if (f >= 0) {
      left = Math.min(left, f);
      right = Math.max(right, l + 1);
    }
  }
  // Tiny specks (a stray dot) are not worth a picture.
  if (right - left < 6 && bottom - top < 6) return null;
  return clampBox(p, { x0: left - pad, y0: top - pad, x1: right + pad, y1: bottom + pad });
}

function clampBox(p: Pixels, b: Box): Box {
  return {
    x0: Math.max(0, Math.floor(b.x0)),
    y0: Math.max(0, Math.floor(b.y0)),
    x1: Math.min(p.width, Math.ceil(b.x1)),
    y1: Math.min(p.height, Math.ceil(b.y1)),
  };
}
