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
  Optional gives you a switch on the review screen.
- **Review screen** scheduled by FSRS. Space shows the answer, 1 to 4 rates it
  (Again, Hard, Good, Easy), and each button shows when the card will come back.
- **Study filters**: everything due, one subject, one deck or one topic.
- **Settings**: target retention (90% normally, 95% for exam weeks), new cards
  per day (20 by default) and when the study day rolls over (4am).
- **Backup and restore** of everything as one file, with a reminder on the Today
  screen if you have not backed up for 7 days.
- **Offline**: the app saves its own files, so it opens on the bus with no signal.
  Your cards are stored in the browser (IndexedDB).

Practice, Planner and Progress are in the menu already and say what is coming.

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
    markdown.ts      card text to HTML, with Obsidian-style maths through KaTeX
    backup.ts        backup file export, checks and restore
    cards.ts         card helpers (tags, typing setting, comparing typed answers)
  screens/           one Svelte file per screen
  components/        pieces shared by screens
tests/               automatic tests (Vitest)
server.js            tiny file server for Railway
```

Later phases add their own records to `types.ts`, new stores in `db.ts` (by
raising the database version), and their own screens. Phase 2 is Anki `.apkg` import.
