# StudyFlow data schema

How StudyFlow stores each student's progress and mistake history.

## Where the data lives

| Place | What | Who can read it |
|---|---|---|
| Browser `localStorage` key `studyflow-data` | The student's whole study record (below). Works offline. | Only that device |
| Redis `sf:data:<email>` | A synced copy of the same record, so it follows the student to other devices. Written by `/api/account` when signed in. | Only the signed-in owner (signed session token) |
| Redis `sf:datameta:<email>` | `{ v, updated, bytes }`: version number and last sync time, used to pick the newest copy. | Server only |
| Redis `sf:user:<email>` | Account: `{ hash, salt, codeHash, codeSalt, google, created, plusUntil, plusHistory[] }`. Passwords are scrypt hashes, never plain text. | Server only |
| Redis `sf:usage:<email or ip>:<YYYY-MM-DD>` | AI requests used today (expires after 2 days). | Server only |

All times are milliseconds since 1970 (`Date.now()`), and dates are `YYYY-MM-DD`.

## The study record (`studyflow-data`)

```text
profile      { name, role: student|teacher|parent, grade, syllabus, board, school,
               subjects: [string], hardest, aim, goal (minutes/day), lang,
               onboarded, starterBuilt, sqAuto (StudyQuest auto-build on/off) }

quiz         { attempted: number, correct: number }          // lifetime totals
hist         [ { d: date, sub, topic, ok: bool, lv } ]       // every answered question

mistakes     [ { id, question, subject, lesson, date } ]     // Mistake Bank (newest first)

mx           // Mistake → Mastery engine
  topics     { "<subject>|<topic>": {
                 subject, topic,
                 h: [ { d: time, ok: bool, v: 0..1, w: weight, s: source } ],  // last 60 attempts
                 score: 0..100 | null,       // recency-weighted mastery
                 retained, interval: days, next: date, last: time } }  // spaced review
  items      [ { id, subject, topic, question, wrong, right, type, status, created, reviews[] } ]
               // mistakes being fixed: status = new | active | mastered
  marks      [ { id, date, board, subject, question, max, awarded, low, high, cmd,
                 points: [ { point, marks, type, awarded, evidence, source, schemeLine } ],
                 missing, outOfSyllabus, strengths[], improve[], model, confidence, basis } ]
               // Exam Examiner results, newest first, max 80
  mocks      [ { id, date, subject, score, max, topics[] } ]
  events     [ { d: time, kind, subject, topic } ]       // activity log for streaks and charts
  syllabus   { "<subject>": [topic names] }
  prefs      { minutes, ... }

flashcards   [ { id, front, back, set, learned: bool, lv, due } ]
fcmeta       { "<set name>": { color, emoji, created, last, keep, starter } }
tasks        [ { id, title, subject, date, time, duration, done } ]
exams        [ { subject, date } ]
sessions     [ { date, subject, minutes } ]                  // focus sessions
notes        [ { id, title, body, subject, created } ]
chat         [ { role: user|assistant, content } ]           // AI Coach conversation

island       // StudyQuest
  coins, gems, xp, world, built{}, decor[], worlds{}, decks{},
  day        { date, q: [quest keys], claimed{}, c: { rc, ans, perf, runs, win, subs{} } }
  qbank      { "<subject>": { qs: [ { id, text, options[4], correct, explain, topic,
                                     src: ai|start } ],
                              seen: { questionId: timesPlayed }, ai, day, calls } }
```

## How mastery is worked out

Each answer adds one entry to `mx.topics[...].h`. The `score` weights recent answers more than old ones (each older answer counts 0.88× the one after it), and Exam Examiner marks count more than quick quiz answers. After a correct answer the review gap grows (×2.2, up to 45 days); after a wrong one it resets to 1 day. "Needs attention" lists topics under 85% that belong to the student's own subjects (`profile.subjects`).

## Privacy rules

- The record is only synced when the student is signed in, and only the owner's token can read it.
- Teachers in Classes see a summary (mastery scores, study minutes, open mistakes, exam scores, assignments done), never notes, chats or answers.
- Payments: StudyFlow stores the Razorpay link ID and plan, never card or bank details.
