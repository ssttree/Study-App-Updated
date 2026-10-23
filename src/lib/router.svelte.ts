// A tiny hash router: the part of the address after # picks the screen,
// e.g. #/decks or #/review/subject/Chemistry. Hash addresses work offline
// and on any static host without server setup.

export type Route =
  | { name: 'today' }
  | { name: 'review'; filter: string[] }
  | { name: 'custom'; filter: string[] }
  | { name: 'customRun'; parts: string[] }
  | { name: 'decks' }
  | { name: 'deck'; id: string }
  | { name: 'card'; id: string }
  | { name: 'newCard'; deckId: string }
  | { name: 'import' }
  | { name: 'settings' }
  | { name: 'later'; feature: 'practice' | 'planner' | 'progress' }
  | { name: 'notFound' };

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  const [head, ...rest] = parts;
  switch (head) {
    case undefined:
    case 'today':
      return { name: 'today' };
    case 'review':
      return { name: 'review', filter: rest };
    case 'custom':
      return rest[0] === 'run' ? { name: 'customRun', parts: rest.slice(1) } : { name: 'custom', filter: rest };
    case 'decks':
      return rest[0] ? { name: 'deck', id: rest[0] } : { name: 'decks' };
    case 'import':
      return { name: 'import' };
    case 'card':
      if (rest[0] === 'new') return { name: 'newCard', deckId: rest[1] ?? '' };
      return rest[0] ? { name: 'card', id: rest[0] } : { name: 'notFound' };
    case 'settings':
      return { name: 'settings' };
    case 'practice':
    case 'planner':
    case 'progress':
      return { name: 'later', feature: head };
    default:
      return { name: 'notFound' };
  }
}

export function href(...parts: string[]): string {
  return '#/' + parts.map((p) => encodeURIComponent(p)).join('/');
}

export function go(...parts: string[]): void {
  location.hash = href(...parts);
}

class Router {
  route = $state<Route>(parseHash(typeof location === 'undefined' ? '' : location.hash));

  constructor() {
    // Tests run without a browser, where there is no address to follow.
    if (typeof window === 'undefined') return;
    window.addEventListener('hashchange', () => {
      this.route = parseHash(location.hash);
      window.scrollTo(0, 0);
    });
  }
}

export const router = new Router();
