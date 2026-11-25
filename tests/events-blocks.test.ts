import { describe, expect, it } from 'vitest';
import { blockItem, changedItem, cleanPick, eventItem, withBlock, withoutBlock } from '../src/lib/planner/blocks';
import { blockEvents } from '../src/lib/planner/calendar';
import { hasPick, itemColour, itemLink, itemText, pickText, type StudyNames } from '../src/lib/planner/labels';
import { filterFromParts, filterToParts, filterLabel, reviewHref } from '../src/lib/filters';
import { matchesFilter } from '../src/lib/queue';
import { buildPickedSet, newSkill } from '../src/lib/practice/mix';
import { defaultAvailability } from '../src/lib/planner/availability';
import type { Card, Deck, PlanItem, Problem, Skill } from '../src/lib/types';

const NOW = Date.UTC(2026, 10, 25, 8);
const MON = '2026-11-30';

function item(fields: Partial<PlanItem> = {}): PlanItem {
  return { id: 'i1', kind: 'event', windowId: 'cal', start: '16:00', minutes: 30, pinned: true, status: 'todo', ...fields };
}

const names: StudyNames = {
  skills: new Map([
    ['s1', 'Equilibrium'],
    ['s2', 'Acids'],
    ['s3', 'Redox'],
  ]),
  decks: new Map([['d1', 'Chem M5']]),
};

describe('events you add by hand', () => {
  it('keeps a name, a sensible length and only real picks', () => {
    const e = eventItem({ title: '  Dentist ', start: '10:00', minutes: 2, study: { skillIds: [], deckIds: [] } });
    expect(e).toEqual({ kind: 'event', start: '10:00', minutes: 5, title: 'Dentist' });
    expect(eventItem({ title: '', minutes: 45, study: { skillIds: ['s1', 's1'] } })).toMatchObject({ title: 'Event', study: { skillIds: ['s1'] } });
  });

  it('is not study unless something is picked, so Start has nowhere to go', () => {
    const plain = item({ title: 'Dentist' });
    expect(hasPick(plain.study)).toBe(false);
    expect(itemLink(plain, new Map())).toBe('');
    expect(itemText(plain, new Map(), new Map(), MON)).toEqual({ title: 'Dentist', detail: '' });
    expect(itemColour(plain)).toBe('var(--dot)');
  });

  it('goes to Google without "Study:" unless it has study in it', () => {
    const plain = item({ id: 'a', title: 'Dentist' });
    const study = item({ id: 'b', title: 'Proofs', start: '17:00', study: { skillIds: ['s1'] } });
    const part = blockEvents([{ date: MON, windows: [], plan: { items: [plain, study] } }], (it) => it.title ?? '');
    expect(part.events.map((e) => e.title)).toEqual(['Dentist', 'Study: Proofs']);
  });
});

describe('choosing what to study in an item', () => {
  it('starts practice on one skill, or several together', () => {
    expect(itemLink(item({ minutes: 40, study: { skillIds: ['s1'] } }), new Map())).toBe('#/practice/run/skill/s1/40m');
    expect(itemLink(item({ minutes: 40, study: { skillIds: ['s1', 's2'] } }), new Map())).toBe('#/practice/run/skills/s1%2Cs2/40m');
  });

  it('starts flashcards on the picked decks when no skills are picked', () => {
    expect(itemLink(item({ study: { deckIds: ['d1'] } }), new Map())).toBe('#/review/deck/d1');
    expect(itemLink(item({ study: { deckIds: ['d1', 'd2'] } }), new Map())).toBe('#/review/decks/d1%2Cd2');
  });

  it('replaces what a built-in item opens, and leaves it alone with nothing picked', () => {
    const flash = item({ kind: 'flashcards' });
    expect(itemLink(flash, new Map())).toBe('#/review');
    expect(itemLink({ ...flash, study: { deckIds: ['d1'] } }, new Map())).toBe('#/review/deck/d1');
    const prep = item({ kind: 'prep', assessmentId: 'a1', minutes: 45 });
    expect(itemLink(prep, new Map())).toBe('#/practice/run/plan/a1/45m');
  });

  it('says what was picked', () => {
    expect(pickText({ skillIds: ['s1', 's2', 's3'], deckIds: ['d1'] }, names)).toBe('Equilibrium + Acids + 1 more · cards: Chem M5');
    expect(itemText(item({ kind: 'flashcards', study: { deckIds: ['d1'] } }), new Map(), new Map(), MON, names)).toEqual({
      title: 'Flashcards',
      detail: 'cards: Chem M5',
    });
  });

  it('saves changes from the window and pins the item', () => {
    const before = item({ pinned: false, study: { skillIds: ['s1'] } });
    const after = changedItem(before, { title: 'Proofs', minutes: 60, start: '18:00', study: { skillIds: [] }, started: true });
    expect(after).toMatchObject({ title: 'Proofs', minutes: 60, start: '18:00', pinned: true, started: true });
    expect(after.study).toBeUndefined();
    // A built-in item keeps its own name.
    expect(changedItem(item({ kind: 'homework', title: undefined }), { title: 'x' }).title).toBeUndefined();
  });
});

describe('reusable blocks', () => {
  it('can be made, changed and deleted', () => {
    let a = defaultAvailability();
    a = withBlock(a, { id: 'b1', name: 'Chem cards', minutes: 30, study: { deckIds: ['d1'] } });
    a = withBlock(a, { id: 'b2', name: ' ', minutes: 45 });
    expect(a.blocks?.map((b) => b.name)).toEqual(['Chem cards', 'Study block']);
    a = withBlock(a, { id: 'b1', name: 'Chem cards', minutes: 20, study: { deckIds: ['d1'] } });
    expect(a.blocks?.[0].minutes).toBe(20);
    a = withoutBlock(a, 'b2');
    expect(a.blocks?.map((b) => b.id)).toEqual(['b1']);
  });

  it('turns into an event when dragged onto a time', () => {
    const made = blockItem({ id: 'b1', name: 'Ext 2 proofs', minutes: 45, study: { skillIds: ['s1'] } }, '16:30');
    expect(made).toEqual({ kind: 'event', start: '16:30', minutes: 45, title: 'Ext 2 proofs', study: { skillIds: ['s1'] }, blockId: 'b1' });
  });

  it('drops empty picks', () => {
    expect(cleanPick({ skillIds: [], deckIds: [] })).toBeUndefined();
    expect(cleanPick({ skillIds: ['a', 'a', ''] })).toEqual({ skillIds: ['a'] });
  });
});

describe('flashcards from several decks', () => {
  it('round trips through the address and matches only those decks', () => {
    const f = filterFromParts(['decks', 'd1,d2']);
    expect(f).toEqual({ kind: 'decks', deckIds: ['d1', 'd2'] });
    expect(filterToParts(f)).toEqual(['decks', 'd1,d2']);
    expect(reviewHref({ kind: 'decks', deckIds: ['d1'] })).toBe('#/review/deck/d1');
    const card = (deckId: string) => ({ deckId, tags: [] }) as unknown as Card;
    expect(matchesFilter(card('d2'), new Map(), f)).toBe(true);
    expect(matchesFilter(card('d3'), new Map(), f)).toBe(false);
    const decks = [{ id: 'd1', name: 'Chem M5' }, { id: 'd2', name: 'Chem M6' }] as Deck[];
    expect(filterLabel(f, decks)).toBe('Chem M5 + Chem M6');
  });
});

describe('practice on several picked skills', () => {
  function skill(name: string): Skill {
    return newSkill({ subject: 'Chemistry', name, topic: 'M5', code: 'M5' }, NOW);
  }
  function problems(s: Skill, n: number): Problem[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `${s.id}-p${i}`,
      skillId: s.id,
      source: 'smartered' as const,
      label: `Q${i + 1}`,
      from: s.name,
      key: `${s.id}|${i}`,
      marks: 2,
      mc: false,
      questionImage: `img-${s.id}-${i}`,
      order: i,
      created: NOW,
    }));
  }

  it('shares the time and takes questions in turn', () => {
    const a = skill('A');
    const b = skill('B');
    const set = buildPickedSet({ skills: [a, b], problems: [...problems(a, 10), ...problems(b, 10)], attempts: [], plans: [] }, [a.id, b.id], 30, NOW, () => 0.5);
    expect(set.length).toBeGreaterThanOrEqual(4);
    expect(set[0].skill.id).toBe(a.id);
    expect(set[1].skill.id).toBe(b.id);
    expect(set.filter((m) => m.skill.id === a.id).length).toBe(set.filter((m) => m.skill.id === b.id).length);
  });
});
