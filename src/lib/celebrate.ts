// A short burst of confetti from wherever a session was ticked off, so
// finishing one feels like something. Skipped when the system asks for less
// motion.

const COLOURS = ['#f5b94a', '#6fcf97', '#7cb7ff', '#f28b82', '#c3a6ff', '#ffe08a'];

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Throws confetti out from the middle of `from` (or the middle of the screen).
 * Pass a box measured before the page changes when the element is about to go.
 */
export function celebrate(from?: Element | DOMRect | null): void {
  if (typeof document === 'undefined' || reducedMotion()) return;
  const box = from instanceof Element ? from.getBoundingClientRect() : from;
  const x = box ? box.left + box.width / 2 : window.innerWidth / 2;
  const y = box ? box.top + box.height / 2 : window.innerHeight / 3;
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(layer);

  const pieces = 28;
  const runs: Promise<unknown>[] = [];
  for (let i = 0; i < pieces; i++) {
    const p = document.createElement('span');
    const size = 6 + Math.random() * 6;
    const round = Math.random() < 0.4;
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${round ? size : size * 0.45}px;background:${COLOURS[i % COLOURS.length]};border-radius:${round ? '50%' : '2px'}`;
    layer.appendChild(p);
    const angle = (Math.PI * 2 * i) / pieces + Math.random() * 0.4;
    const speed = 70 + Math.random() * 110;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed - 60;
    const spin = (Math.random() - 0.5) * 720;
    const anim = p.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.6) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx * 1.25}px), calc(-50% + ${dy + 140}px)) scale(0.9) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    );
    runs.push(anim.finished.catch(() => undefined));
  }
  Promise.all(runs).then(() => layer.remove());
  // Belt and braces, in case an animation never reports finishing.
  setTimeout(() => layer.remove(), 2500);
}
