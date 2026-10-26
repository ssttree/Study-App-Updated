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
  | { name: 'atarImport'; taskId?: string }
  | { name: 'plans' }
  | { name: 'plan'; id: string; from?: 'planner' }
  | { name: 'practiceRun'; parts: string[] }
  | { name: 'planner'; day?: string }
  | { name: 'homework' }
  | { name: 'task'; id: string; assessmentId?: string }
  | { name: 'windows' }
  | { name: 'exams' }
  | { name: 'connect'; result?: string }
  | { name: 'progress' }
  | { name: 'progressSubject'; subject: string }
  | { name: 'progressTopic'; subject: string; topic: string }
  | { name: 'activity' }
  | { name: 'marks' }
  | { name: 'mark'; id: string; assessmentId?: string; year?: 11 }
  | { name: 'weeklyReview' }
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
      return progressRoute(rest);
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
      return more[0] === 'task' && more[1] ? { name: 'atarImport', taskId: more[1] } : { name: 'atarImport' };
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

function progressRoute(rest: string[]): Route {
  const [sub, ...more] = rest;
  switch (sub) {
    case undefined:
      return { name: 'progress' };
    case 'subject':
      return more[0] ? { name: 'progressSubject', subject: more[0] } : { name: 'progress' };
    case 'topic':
      return more[0] && more[1] ? { name: 'progressTopic', subject: more[0], topic: more[1] } : { name: 'progress' };
    case 'activity':
      return { name: 'activity' };
    case 'marks':
      return { name: 'marks' };
    case 'mark':
      if (more[0] === 'new') return { name: 'mark', id: 'new', assessmentId: more[1] && more[1] !== 'y11' ? more[1] : undefined, year: more[1] === 'y11' ? 11 : undefined };
      return { name: 'mark', id: more[0] ?? 'new' };
    case 'review':
      return { name: 'weeklyReview' };
    default:
      return { name: 'notFound' };
  }
}

function plannerRoute(rest: string[]): Route {
  const [sub, ...more] = rest;
  switch (sub) {
    case undefined:
      return { name: 'planner' };
    case 'day':
      return { name: 'planner', day: more[0] };
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
