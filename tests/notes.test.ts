import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS server code
import { cardsMade, cardsToMake, createNotesReader, lessonPaths, lessonsFrom } from '../server/notes.js';

const LESSON = `---
tags:
cards-made: false
---
Up: [[Overview]]

### Cards to Make
- [ ] What is the magnitude of a unit vector
- [x] Already made
- [ ] 

## Practice
- [ ] Textbook
`;

describe('Obsidian notes', () => {
  it('groups notes under the nearest Overview note', () => {
    const got = lessonPaths([
      'Maths/Chapter 1/Overview - Chapter 1.md',
      'Maths/Chapter 1/Geometric.md',
      'Maths/Chapter 1/Deeper/Proofs.md',
      'Chem/Module 5/Syllabus - Module 5.md',
      'Chem/Module 5/Le Chatelier.md',
      'Templates/Maths.md',
      'Christmas List.md',
      'Images/pic.png',
    ]);
    expect(got).toEqual([
      { path: 'Maths/Chapter 1/Geometric.md', topic: 'Chapter 1', topicFolder: 'Maths/Chapter 1' },
      { path: 'Maths/Chapter 1/Deeper/Proofs.md', topic: 'Chapter 1', topicFolder: 'Maths/Chapter 1' },
      { path: 'Chem/Module 5/Le Chatelier.md', topic: 'Module 5', topicFolder: 'Chem/Module 5' },
    ]);
  });

  it('reads cards-made and the cards still to make', () => {
    expect(cardsMade(LESSON)).toBe(false);
    expect(cardsMade('---\ncards-made: true\n---\nx')).toBe(true);
    expect(cardsMade('---\ntags: a\n---\nx')).toBeNull();
    expect(cardsMade('no front matter')).toBeNull();
    expect(cardsToMake(LESSON)).toEqual(['What is the magnitude of a unit vector']);
  });

  it('keeps only notes with a cards-made line', () => {
    const lessons = lessonsFrom([
      { path: 'Maths/Ch 1/Vectors.md', topic: 'Ch 1', topicFolder: 'Maths/Ch 1', text: LESSON },
      { path: 'Maths/Ch 1/Random.md', topic: 'Ch 1', topicFolder: 'Maths/Ch 1', text: 'hello' },
    ]);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ name: 'Vectors', subject: 'Maths', cardsMade: false, toMake: ['What is the magnitude of a unit vector'] });
  });

  it('reads the repo through the GitHub API, downloading each note once', async () => {
    process.env.NOTES_TOKEN = 'test';
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(url);
      const body = url.includes('/git/trees/')
        ? { tree: [{ type: 'blob', path: 'Maths/Ch 1/Overview - Ch 1.md', sha: 'o' }, { type: 'blob', path: 'Maths/Ch 1/Vectors.md', sha: 'v' }] }
        : { content: Buffer.from(LESSON).toString('base64'), encoding: 'base64' };
      return { ok: true, status: 200, json: async () => body } as Response;
    };
    const reader = createNotesReader(fake as unknown as typeof fetch);
    const first = await reader.read();
    await reader.read();
    expect(first.lessons.map((l: { name: string }) => l.name)).toEqual(['Vectors']);
    expect(calls.filter((c) => c.includes('/git/blobs/'))).toHaveLength(1);
    delete process.env.NOTES_TOKEN;
  });
});
