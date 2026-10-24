# Study App

A personal study app for HSC, built on techniques that are proven to help you
remember: spaced repetition (FSRS) and active recall.

This is **phase 1: core flashcards**. It runs entirely in your browser and
works with no internet once it has been opened once.

## What it does

- **Decks** organised by subject and module, with topics and free text tags on each card.
- **Card editor** with a live preview. Maths is written the Obsidian way:
  `$x^2$` inside a sentence, `$$ ... $$` on its own line. Chemistry works with
  `$\ce{2H2 + O2 -> 2H2O}$`. Mistakes in the maths show up in red straight away.
- **Basic and both-ways cards**, with an optional picture.
- **Typing the answer**: each deck (or card) is set to Off, Always or Optional.
  Optional gives you a switch on the review screen. Typed answers are checked
  for you: lists count in any order ("calcium, barium" = "barium, calcium"),
  chemistry can be typed plainly (`N2 + 3H2 <=> 2NH3`, shown as N₂ + 3H₂ ⇌ 2NH₃),
  capitals only matter in formulas, and one slip in a long word counts as close.
  A card can have an "answer to check" written plainly, with `|` between other
  accepted answers.
- **Review screen** scheduled by FSRS. Space shows the answer, 1 to 4 rates it
  (Again, Hard, Good, Easy), and each button shows when the card will come back.
- **Study filters**: everything due, one subject, one deck or one topic.
- **Custom study**: go over cards again whenever you like: the cards you studied
  today, ones you forgot recently, or every card in a subject, deck, topic or tag.
  It is extra practice only, so it never changes when cards are next due.
- **Settings**: target retention (90% normally, 95% for exam weeks), new cards
  per day (20 by default) and when the study day rolls over (4am).
- **Backup and restore** of everything as one file, with a reminder on the Today
  screen if you have not backed up for 7 days.
- **Anki import** (Cards, Import from Anki): pick an `.apkg` file exported from
  Anki and each Anki deck becomes a deck here, or joins one you already have.
  Cards start fresh in FSRS. Anki maths `\(...\)` and `\[...\]` becomes `$...$`
  and `$$...$$`, pictures come across, "and reversed" notes become both-ways
  cards, "type in the answer" notes become typed cards, and each cloze becomes
  its own card with the gap shown as **[...]**. Sound is left out for now.
  Importing the same deck again skips cards already here.
- **Offline**: the app saves its own files, so it opens on the bus with no signal.
  Your cards and practice questions are stored in the browser (IndexedDB), and backups include them.

### Problem practice (SmarterEd and ATAR Notes)

- **Skills, not single questions.** A skill is one subtopic, usually one SmarterEd worksheet. FSRS schedules
  each skill, and each time it is due you get a question from it you have not done (or not for 60 days), so you
  practise the method instead of remembering one answer.
- **SmarterEd import** (Practice, SmarterEd PDFs): drop in one or more worksheet PDFs. The app reads the
  question headers (like `Functions, EXT1 F2 2016 HSC 2 MC`), cuts out every question and its worked solution as
  pictures, reads the marks, and names the skill after the worksheet title. Pairs that look right are ticked
  straight away; only odd ones are shown to check. Any crop can be redone by dragging a box on the page.
- **Other PDFs** (like class notes with questions in them): the app shows the pages and you drag a box around
  each question, then its answer.
- **ATAR Notes topic tests**: pick the skill once, paste question screenshots (Windows + Shift + S, then
  Ctrl + V), then paste the worked solutions in the same order. They pair up by order.
- **Daily mix**: the app suggests a subject (due skills, weak skills, days since you last did it, and tests
  coming up), then fills your problem block (35 min by default, 1.5 min per mark) with questions from due skills,
  new skills and a couple of weak ones, shuffled so you have to work out the method. Skills you mixed up are put
  side by side.
- **Test plans**: pick a test date and the skills it covers. Those skills get first claim on that subject's
  problems, and "Practise for it" goes round them until each has come up at least twice.
- **Marking on paper**: work the question on paper, reveal the worked solution, say if you picked the right
  method (and which skill you mixed it up with), then rate it Again, Hard, Good or Easy. Multiple choice letters
  are checked once the app knows the right one.
- **Sub-skills**: tick some questions on a broad worksheet (like Graphing) and make them a sub-skill with its own
  schedule.

Planner and Progress are in the menu already and say what is coming.

## Running it on your laptop

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install      # once, downloads the libraries
npm run dev      # starts the app at http://localhost:5173 and reloads when you edit
```

Other commands:

```bash
npm test         # runs the automatic tests
npm run check    # checks the TypeScript and Svelte code for mistakes
npm run build    # makes the finished app in the dist folder
npm start        # serves the finished app (this is what Railway runs)
```

## Putting it online with Railway

1. In Railway, make a new project and choose **Deploy from GitHub repo**, then pick this repo.
2. Railway reads `railway.json`: it runs `npm run build`, then `npm start`.
3. Under the service's **Settings > Networking**, click **Generate Domain** to get a web address.

Open that address once on your laptop while online. After that it works offline.
Cards stay in that browser on that laptop, so keep backups (Settings > Download backup).

## How the code is laid out

```
src/
  main.ts            starts the app, loads fonts and turns on offline mode
  App.svelte         top menu and picks the screen from the address (#/decks etc.)
  theme.css          the "Night desk" colours, fonts and shared styles
  lib/
    types.ts         the shape of decks, cards, review logs and settings
    db.ts            saving and loading from IndexedDB
    scheduler.ts     FSRS (via ts-fsrs): rating a card and working out intervals
    queue.ts         which cards to review now, new card limit, study filters
    custom.ts        picking cards for custom study
    markdown.ts      card text to HTML, with Obsidian-style maths through KaTeX
    backup.ts        backup file export, checks and restore
    cards.ts         card helpers (tags, typing setting)
    answers.ts       checking typed answers and showing plain chemistry nicely
    anki/            Anki .apkg import: read.ts opens the file (zip + SQLite),
                     html.ts turns Anki HTML and templates into Markdown,
                     convert.ts builds the cards, import.ts saves them
  screens/           one Svelte file per screen
  components/        pieces shared by screens
tests/               automatic tests (Vitest)
server.js            tiny file server for Railway
```

Later phases add their own records to `types.ts`, new stores in `db.ts` (by
raising the database version), and their own screens.
