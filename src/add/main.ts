// The phone's quick add page. It only adds homework: each task goes to the
// server's inbox, and the laptop collects it next time it's online. With no
// signal, tasks wait on the phone and send themselves later.

import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '../theme.css';
import './add.css';

import { registerSW } from 'virtual:pwa-register';
import { parseQuickAdd, shortSubject, subjectFromTitle, type QuickTask } from '../lib/planner/quickadd';
import { dueLabel, todayKey } from '../lib/planner/dates';

const KEY = 'study-app-key';
const PENDING = 'study-app-pending';
const SENT = 'study-app-sent';
/** Same as the app's default: a new day starts at 4am. */
const DAY_START_HOUR = 4;

interface Outgoing {
  title: string;
  subject: string;
  type: QuickTask['type'];
  due: string;
  minutes: number;
  required: boolean;
  study: QuickTask['study'];
  at: number;
}

const root = document.getElementById('add')!;
let lesson = '';
let note = '';

function load<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(name) ?? '') as T;
  } catch {
    return fallback;
  }
}
function store(name: string, value: unknown) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    /* private mode: nothing to keep */
  }
}

// The link from the laptop carries the key after #k=. Keep it, then hide it from the address bar.
const fromLink = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromLink) {
  store(KEY, fromLink);
  history.replaceState(null, '', location.pathname);
}
const key = () => load<string>(KEY, '');
const today = () => todayKey(Date.now(), DAY_START_HOUR);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function post(task: Outgoing): Promise<'sent' | 'offline' | 'badkey' | 'error'> {
  try {
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-study-key': key() },
      body: JSON.stringify(task),
    });
    if (res.ok) return 'sent';
    return res.status === 401 ? 'badkey' : 'error';
  } catch {
    return 'offline';
  }
}

/** Sends anything still waiting, oldest first. */
async function flush() {
  let pending = load<Outgoing[]>(PENDING, []);
  for (const task of [...pending]) {
    const result = await post(task);
    if (result === 'offline') {
      note = 'No signal. It will send by itself when you are back online.';
      break;
    }
    if (result === 'badkey') {
      note = 'The app key is wrong. Open the link from the laptop again (Planner, Phone and Google).';
      break;
    }
    pending = pending.filter((t) => t !== task);
    store(PENDING, pending);
    if (result === 'sent') {
      store(SENT, [task, ...load<Outgoing[]>(SENT, [])].slice(0, 8));
      note = '';
    } else {
      note = `The server didn't take "${task.title}". Add it on the laptop instead.`;
    }
  }
  render();
}

async function guessLesson() {
  try {
    const res = await fetch('/api/lesson-now', { headers: { 'x-study-key': key() } });
    if (res.ok) lesson = subjectFromTitle(((await res.json()) as { title: string | null }).title);
  } catch {
    /* offline: no guess */
  }
  render();
}

function chips(q: QuickTask): string {
  const bits = [
    `<span class="chip strong">${esc(q.title)}</span>`,
    `<span class="chip${q.found.subject ? '' : ' guess'}">${q.subject ? esc(shortSubject(q.subject)) : 'no subject'}${!q.found.subject && q.subject ? ' (lesson now)' : ''}</span>`,
    `<span class="chip${q.found.due ? '' : ' guess'}">${dueLabel(q.due, today())}</span>`,
    `<span class="chip${q.found.minutes ? '' : ' guess'}">${q.minutes} min</span>`,
  ];
  if (q.type === 'smartered') bits.push('<span class="chip">SmarterEd set</span>');
  if (q.type === 'assignment') bits.push('<span class="chip">assignment</span>');
  if (q.study === 'flashcards') bits.push('<span class="chip">flashcards, bus is fine</span>');
  if (!q.required) bits.push('<span class="chip">optional</span>');
  return bits.join('');
}

function parse(line: string): QuickTask | null {
  if (!line.trim()) return null;
  const q = parseQuickAdd(line, today());
  return q.found.subject || !lesson ? q : { ...q, subject: lesson };
}

function render() {
  if (!key()) {
    root.innerHTML = `
      <h1>Add homework</h1>
      <p class="muted">Open the phone link from the laptop app (Planner, Phone and Google), or paste the app key here.</p>
      <form id="keyform" class="bar">
        <input id="key" type="password" placeholder="App key" autocomplete="off" aria-label="App key" />
        <button class="btn primary" type="submit">Save</button>
      </form>`;
    document.getElementById('keyform')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = (document.getElementById('key') as HTMLInputElement).value.trim();
      if (value) store(KEY, value);
      render();
      guessLesson();
    });
    return;
  }
  const pending = load<Outgoing[]>(PENDING, []);
  const sent = load<Outgoing[]>(SENT, []);
  const old = document.getElementById('line') as HTMLInputElement | null;
  const value = old?.value ?? '';
  const row = (t: Outgoing, waiting: boolean) =>
    `<li><span class="dot${waiting ? ' wait' : ''}"></span><span class="t">${esc(t.title)}</span><span class="mono muted">${waiting ? 'waiting' : esc(dueLabel(t.due, today()))}</span></li>`;
  root.innerHTML = `
    <div class="eyebrow accent">Study App</div>
    <h1>Add homework</h1>
    <form id="form">
      <div class="bar">
        <input id="line" type="text" placeholder="chem finish q5-10 fri 20m" autocomplete="off" autocapitalize="off" enterkeyhint="done" aria-label="Homework" />
        <button id="go" class="btn primary" type="submit">Add</button>
      </div>
      <div id="chips" class="chips mono" aria-live="polite"></div>
    </form>
    ${note ? `<div class="notice warn">${esc(note)}</div>` : ''}
    <p class="muted small">
      Subject, day and time in any order: <span class="mono">chem</span>, <span class="mono">ext1</span>,
      <span class="mono">adv</span>, <span class="mono">eng</span>; <span class="mono">fri</span>,
      <span class="mono">tmr</span>, <span class="mono">3/11</span>; <span class="mono">20m</span>.
      <span class="mono">set</span> for SmarterEd, <span class="mono">opt</span> if optional,
      <span class="mono">cards</span> for flashcards you can do on the bus.
    </p>
    ${pending.length || sent.length ? `<h2>Added</h2><ul class="list">${pending.map((t) => row(t, true)).join('')}${sent.map((t) => row(t, false)).join('')}</ul>` : ''}`;
  const input = document.getElementById('line') as HTMLInputElement;
  const chipBox = document.getElementById('chips')!;
  const go = document.getElementById('go') as HTMLButtonElement;
  const preview = () => {
    const q = parse(input.value);
    chipBox.innerHTML = q ? chips(q) : '';
    go.disabled = !q;
  };
  input.value = value;
  input.addEventListener('input', preview);
  preview();
  document.getElementById('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = parse(input.value);
    if (!q) return;
    const task: Outgoing = { title: q.title, subject: q.subject, type: q.type, due: q.due, minutes: q.minutes, required: q.required, study: q.study, at: Date.now() };
    store(PENDING, [...load<Outgoing[]>(PENDING, []), task]);
    input.value = '';
    flush();
  });
  if (!value) input.focus();
}

render();
flush();
guessLesson();
window.addEventListener('online', () => flush());
registerSW({ immediate: true });
