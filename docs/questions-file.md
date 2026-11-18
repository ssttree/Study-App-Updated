# Questions file

A Markdown file of typed questions and answers that the app imports into
problem practice (Practice > Questions file from Claude, `#/practice/file`).
Claude writes these from documents uploaded in chat; the app reads them with
`src/lib/practice/qfile.ts`.

```markdown
---
subject: Chemistry
from: 2023 Trial Paper
---

## Le Chatelier's principle
topic: Module 5 Equilibrium

### Q21 · 3 marks
Question text. Markdown, maths as $inline$ or $$display$$, chemistry as $\ce{...}$.

#### Answer
Answer or marking guideline.

### Q3 · MC
Question with options A to D on their own lines.

#### Answer
B
```

- Front matter is optional: `subject` (default for every skill) and `from` (where the questions came from).
- `## ` starts a skill (one worksheet-sized method, like the app's other skills). `subject:` and `topic:` lines straight after it override or add to the defaults. A skill with the same name and subject as one in the app gets the questions added to it.
- `### ` starts a question. Parts split by `·` or `|`: `3 marks` sets the marks, `MC` marks multiple choice, the rest is the label (like `2019 HSC Q12a`).
- `#### Answer` (or Solution) starts the answer.
- Subjects: Maths Advanced, Maths Extension 1, Maths Extension 2, English Advanced, Chemistry, Business Studies, Engineering Studies (short forms like `ext1`, `chem` work too).
- Text only: pictures and diagrams in the source have to be described in words.
- Importing the same question twice is skipped.
