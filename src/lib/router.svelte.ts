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
  | { name: 'practice' }
  | { name: 'skills'; subject?: string }
  | { name: 'skill'; id: string }
  | { name: 'pdfImport'; taskId?: string }
  | { name: 'atarImport' }
  | { name: 'plans' }
  | { name: 'plan'; id: string; from?: 'planner' }
  | { name: 'practiceRun'; parts: string[] }
  | { name: 'planner' }
  | { name: 'homework' }
  | { name: 'task'; id: string; assessmentId?: string }
  | { name: 'windows' }
  | { name: 'exams' }
  | { name: 'connect'; result?: string }
  | { name: 'later'; feature: 'progress' }
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
      return practiceRoute(rest);
    case 'planner':
      return plannerRoute(rest);
    case 'progress':
      return { name: 'later', feature: head };
    default:
      return { name: 'notFound' };
  }
}

function practiceRoute(rest: string[]): Route {
  const [sub, ...more] = rest;
  switch (sub) {
    case undefined:
      return { name: 'practice' };
    case 'skills':
      return { name: 'skills', subject: more[0] };
    case 'skill':
      return more[0] ? { name: 'skill', id: more[0] } : { name: 'skills' };
    case 'import':
      return more[0] === 'task' && more[1] ? { name: 'pdfImport', taskId: more[1] } : { name: 'pdfImport' };
    case 'atar':
      return { name: 'atarImport' };
    case 'plans':
      return { name: 'plans' };
    case 'plan':
      return { name: 'plan', id: more[0] ?? 'new' };
    case 'run':
      return { name: 'practiceRun', parts: more };
    default:
      return { name: 'notFound' };
  }
}

function plannerRoute(rest: string[]): Route {
  const [sub, ...more] = rest;
  switch (sub) {
    case undefined:
      return { name: 'planner' };
    case 'homework':
      return { name: 'homework' };
    case 'task':
      return { name: 'task', id: more[0] ?? 'new', assessmentId: more[0] === 'new' ? more[1] : undefined };
    case 'windows':
      return { name: 'windows' };
    case 'exams':
      return { name: 'exams' };
    case 'connect':
      return { name: 'connect', result: more[0] };
    case 'exam':
      return { name: 'plan', id: more[0] ?? 'new', from: 'planner' };
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
