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
  Your cards, practice questions, homework and plans are stored in the browser (IndexedDB), and backups include them.

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
- **Moving questions**: tick questions on any skill and move them to another skill, for when a worksheet has a
  question that really belongs to a different topic. Your past attempts on them move too.

### Planner and homework

- **Homework list** (Planner, Homework): type one short line and it works out the rest.
  `chem finish q5-10 fri 20m` is a Chemistry task due Friday that takes 20 minutes. Subjects: `chem`, `adv`,
  `ext1`, `ext2`, `eng` (English), `engin` (Engineering), `bus`. Days: `today`, `tmr`, `fri`, `next fri`, `3/11`.
  Time: `20m`, `1h`, `1h30`. Add `set` for a SmarterEd set and `opt` if it's optional. Anything it can't find
  defaults to due tomorrow, 20 minutes.
- **SmarterEd sets as homework**: add one or more worksheet PDFs. A worksheet whose questions are all in the
  app already is recognised and just linked; new ones run the normal practice import. You can also link a set
  that's already in the app without a PDF. "Do questions" works through every linked worksheet in order,
  questions you haven't tried yet first, and doing them all ticks the homework off. Optional sets just join
  the skill pool. Other homework can have any number of PDFs attached.
- **Study windows** (Planner, Study windows): the times you *can* study each week. Bus windows get flashcards,
  desk windows get homework then problems, flexible windows (like Tuesday night) only get optional things,
  and school study periods get revision (flashcards the bus didn't cover, then problems or test prep).
  Study hours (like "not after 8pm") trim every window except the bus.
  Off season and soccer season have their own windows; on training nights in season, desk windows from 4pm
  drop out. Any single day can be changed by hand.
- **Daily plan**: built every time you open the planner. Flashcards go on the bus (never under 10 minutes),
  required homework goes to the desk due soonest first, and what is left goes to problems (test prep when a
  test is close). If homework due tomorrow won't fit, it says so. Tick, skip, pin, send to tomorrow, move to
  any window (or drag in the week view), swap the problem subject, or press "I've got 20 more minutes".
  Anything you touched stays put when the plan rebuilds. Click a day in the week to open it in full, with
  the same tools and a way to change just that day's windows.
- **Carry-overs**: homework planned for a day and not finished rolls on with a "carried over" tag. After two,
  the planner asks whether to pick a new date, shrink it or drop it.
- **Exams and assessments** (Planner, Exams): class tests ramp up 21, 7 and 2 days out; trials and the HSC
  42, 14 and 3. Build: the subject gets problems more often. Focus: test prep only from in-scope skills, and
  cards in the decks you pick aim for 95% recall. Final: timed sets. Close exams share the days by date and
  weighting. Assignments get milestones (each one a homework task) and warn when one slips. Afterwards, enter
  your mark and tick skills that went badly; they come straight back.

- **Phone quick add** (Planner, Phone and Google): a tiny page for your phone that only adds homework.
  It sends each task to the Railway server, and the laptop collects it next time it's online. With no
  signal, tasks wait on the phone and send themselves later. With your timetable connected, the lesson on
  now is the subject unless you type one.
- **Google Calendar**: due dates go into a calendar the app makes called *Study App: Due dates*, and the
  week's plan goes into *Study App: Study blocks* (untick it in Google to hide it). The app also reads your
  work calendar (a shift takes out any study window it touches, with 30 minutes to get there and back) and
  your school timetable (bus windows drop out on weekdays with no lessons). It can't change any other
  calendar. The laptop syncs every 10 minutes while it's open and online, and keeps the last copy of your
  calendars so the plan still works offline.

### Progress

- **Subjects:** a tile per subject with its mastery (the chance you could do each skill or card today without
  notes, averaged over its topics), how much you have started and an 8 week trend. Green is 90% or more (95%
  when an exam is inside its prep ramp), amber 75% to 89%, red below. Unstarted skills count as 0%; skills
  switched off (not taught yet) are left out. English Advanced is not tracked here.
- **Topics and skills:** open a subject for its topics (weakest first, with recall on the next exam's day),
  then a topic for each skill or flashcard topic: last practised, next due, recent ratings, right method rate.
- **Weak skills:** the top 10 across subjects, ranked by low recall, wrong method taps and Again ratings in
  the last 30 days, with anything on an upcoming exam boosted. Practise goes straight to that skill or those cards.
- **Activity:** minutes, cards and questions per week, fortnight or month, against the same point last
  time and against what the planner planned. No streaks.
- **Marks:** Year 12 results and Year 11 tasks (with ranks) as a baseline. Past tests in the planner wait
  for a mark. Each mark shows recall on the day beside it, which is not a predicted mark.
- **Weekly review:** from Sunday the home screen offers a 10 minute review (look back, what moved, focus
  skills, coming up, marks, a one line note). Focus skills come first in the next week's daily mix. The last
  Sunday of the month looks back over the month.

Recall comes from replaying your review history through FSRS, so past days (trends, recall on a test day)
work without saved snapshots and survive a backup and restore.

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

### Phone quick add and Google Calendar

These need the server to keep a little data (the homework inbox and your Google sign-in), so:

1. In the Railway service, right click the canvas (or press Ctrl K) and add a **Volume**, mounted at `/data`.
2. Under **Variables**, add:
   - `APP_KEY`: a long random password you make up. The app and phone page send it with every request.
   - `DATA_DIR`: `/data`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: from Google Cloud (below).
   - `TIME_ZONE` (optional): defaults to `Australia/Sydney`.
3. In [Google Cloud Console](https://console.cloud.google.com):
   1. Make a new project, then go to **APIs and services > Library** and enable the **Google Calendar API**.
   2. **OAuth consent screen**: choose External, fill in the app name and your email, add the scopes
      `calendar.app.created`, `calendar.calendarlist.readonly` and `calendar.events.readonly`, and add your
      Google account as a test user. Then press **Publish app** so the sign-in doesn't run out after 7 days.
      Google will say the app isn't verified when you sign in; that's fine for your own app (Advanced, Go to).
   3. **Credentials > Create credentials > OAuth client ID**, type Web application. Under Authorised
      redirect URIs add `https://YOUR-RAILWAY-DOMAIN/auth/google/callback`. Copy the client ID and secret
      into Railway.
4. In the app: Planner, Phone and Google. Paste the app key, open the phone link on your phone and add it
   to the home screen, then press Connect Google Calendar and pick your work and timetable calendars.

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
    planner/         homework and the daily plan: quickadd.ts reads a quick add line,
                     availability.ts the study windows and seasons, build.ts makes
                     the plan, assessments.ts the exam ramps, load.ts loads it all,
                     calendar.ts reads and writes Google Calendar events
    progress/        recall.ts replays FSRS for mastery and grades, activity.ts
                     time totals, review.ts the weekly review, load.ts weak
                     skills, exam forecasts and marks
    sync.ts          talks to the server: phone inbox and Google Calendar
  add/               the phone quick add page (add.html), plain TypeScript
    anki/            Anki .apkg import: read.ts opens the file (zip + SQLite),
                     html.ts turns Anki HTML and templates into Markdown,
                     convert.ts builds the cards, import.ts saves them
  screens/           one Svelte file per screen
  components/        pieces shared by screens
tests/               automatic tests (Vitest)
server.js            file server for Railway, plus the API below
server/              api.js (inbox, Google routes), google.js (sign-in and calendar
                     calls), store.js (one JSON file in DATA_DIR)
```

Later phases add their own records to `types.ts`, new stores in `db.ts` (by
raising the database version), and their own screens.
