# Ìwé Ọjà

A phone-first ledger for small businesses: who bought what, what they paid, and what they still owe. Each business runs its own copy with its own name, colours and icons. BECEKO Fabrics & Style's copy is branded Beceko Ledger.

- `brands/README.md` explains brands.
- `docs/onboarding.md` is the checklist for setting up a new business, including subscriptions.
- `docs/admin.md` explains the admin dashboard for managing every business from one page.

## Running it

You need Node.js 22.13 or newer. There is nothing to compile, so no Python or Visual Studio build tools are needed.

```
npm install
cp .env.example .env
```

Open `.env` and set `LEDGER_PIN` (the PIN used to open the ledger) and `SESSION_SECRET` (the file shows how to generate one). Then:

```
npm start
```

Open http://localhost:3000. To use it from a phone on the same Wi-Fi, open `http://<computer's IP address>:3000` and add it to the home screen.

## Quick entry

The home page has a box where you can type or speak notes such as "Mama Chidi paid 5k for her lace". An AI model reads the note, fills in the details and waits for you to check them. Nothing is saved until you press Save. Everything can also be recorded by hand from the customer's page.

Quick entry works with Claude or Gemini. Set one key in `.env` (and in the host's variables):

- `ANTHROPIC_API_KEY` for Claude. The default model is `claude-haiku-5-5`; change it with `ANTHROPIC_MODEL`.
- `GEMINI_API_KEY` for Gemini. The default model is `gemini-flash-latest`; change it with `GEMINI_MODEL`.

If both keys are set, Claude is used. Set `AI_PROVIDER=gemini` to use Gemini instead.

To test the key and model on their own, run:

```
npm run check-ai
```

It sends a test note through the same request quick entry uses and shows how it was read. If the model does not work, it tries other models your key can use and tells you which one to set.

Speaking uses the browser's built-in speech recognition, which is separate from the AI model. It works in Chrome on Android.

## Adding it to the home screen

The app has its own icon, made from the Beceko logo, and opens full screen without the browser bar.

- Android (Chrome): open the link, tap the menu, then "Add to home screen" or "Install app".
- iPhone (Safari): open the link, tap Share, then "Add to Home Screen".

Sign in once inside the home-screen version. If a shortcut was added before the icon existed, remove it and add it again, because phones keep the old icon.

## Statements

Each customer's page has a Statement button. It shows a statement of everything they were charged and paid, with the balance, and lets you share it as a PDF straight to WhatsApp (or any app on the phone) or download it. Cancelled entries are left out, so the customer sees a clean record that still adds up to the same balance.

The statement uses `BUSINESS_NAME` as its heading, so set it to the full business name, for example `BUSINESS_NAME=BECEKO Fabrics & Style`. To print a line at the bottom of every statement, such as bank details or a phone number, set `STATEMENT_NOTE`, for example `STATEMENT_NOTE=Pay to GTBank 0123456789 (Beceko Fabrics & Style). Call 0803 123 4567.`

The thank-you line at the end comes from `STATEMENT_CLOSING`, which defaults to `Thank you for your patronage.` Change it in the variables and redeploy; the PDF and the in-app preview both use it.

The statement font is Lexend, included under the SIL Open Font License (`assets/fonts/OFL.txt`).

## Light and dark mode

The app follows the phone's own setting until someone uses the sun and moon switch at the top. That choice is then remembered on that phone.

## Calendar

The Calendar tab shows how much was received on each day of the month. Tap a day to see who paid, what was sold and at what time. Days are based on when entries were recorded.

## How the money is kept

Amounts are stored in kobo as whole numbers, so balances never drift. Entries cannot be edited or deleted; the database itself refuses. To fix a mistake, use "Cancel entry" on the customer's page. That adds a cancelling line, crosses out the original and corrects the balance, so the full history stays readable.

## Hosting

Any host that runs Node and keeps files on disk between restarts will do: a small VPS, or a platform such as Railway, Render or Fly with a persistent volume. Hosts without a persistent disk will lose the data on restart.

Serve it over HTTPS and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.

## Starting with a clean ledger

There is no button for this in the app, so it can't be done by accident. To clear every customer and entry, for example after testing:

1. Add a variable `RESET_LEDGER` with any value of 8 to 64 letters, digits or hyphens, such as `RESET_LEDGER=fresh-start-1`. On Railway, add it in the service's Variables tab; locally, add it to `.env`.
2. Deploy or restart. The log will say the ledger was cleared and where the old copy was saved (next to the database, for example `/data/ledger-before-reset-202611101200.db`).
3. Remove the variable.

Leaving the variable set does nothing more, because a value is only ever used once. To clear the ledger again in future, use a new value.

## Backups

Every night (02:00 by default, in the business's time zone) the app saves a compressed copy of the whole ledger to S3-compatible cloud storage, such as Backblaze B2. Each copy is a separate file named after the brand and the time, for example `beceko/2026-11-14-0200.db.gz`. If the app was asleep or offline at backup time, which is normal with Railway's Serverless setting, it makes a copy a minute after it next starts whenever the last copy is more than 20 hours old. With Serverless on, that means one copy on the first visit of each day, which is when the records change. The log says when the last copy was made each time the app starts.

**Setting it up with Backblaze B2**

1. Create a Backblaze account and a **private** bucket, for example `iwe-oja-backups`. Turn on encryption if it is offered.
2. Under Application Keys, add a key that can only access that bucket, with read and write access. Copy the key ID and the application key straight away; the application key is shown only once.
3. Set these variables (in Railway, and in `.env` to run the backup commands locally):

   ```
   BACKUP_ENDPOINT=https://s3.<region>.backblazeb2.com
   BACKUP_REGION=<region, for example eu-central-003>
   BACKUP_BUCKET=iwe-oja-backups
   BACKUP_ACCESS_KEY_ID=<key ID>
   BACKUP_SECRET_ACCESS_KEY=<application key>
   ```

   The region is shown on the bucket's page as part of its endpoint. `BACKUP_PREFIX` (the folder in the bucket) defaults to the brand, and `BACKUP_HOUR` (0 to 23) changes the time.
4. Deploy, and check the log says `Nightly backups go to ...`, then `Backup saved: ...` about a minute later.

Backups are small, so keeping them all costs little. To keep only recent ones, add a lifecycle rule on the bucket that deletes files after, say, 90 days.

**Checking and restoring**

- `npm run backups` lists the saved copies. `npm run backup-now` makes one immediately from the local database.
- To restore, set `RESTORE_BACKUP` to the name of a copy, for example `RESTORE_BACKUP=beceko/2026-11-14-0200.db.gz`, and deploy. The log says the ledger was replaced and where the previous version was saved (next to the database, as `ledger-before-restore-...db`). Then remove the variable. As with `RESET_LEDGER`, each value only works once, so leaving it set is harmless.
- If a restore fails, for example because the name is wrong, the app keeps running on its existing records and says why in the log.

The home page also has a link to download every record as a spreadsheet, and each customer's page has a Download records button for just that customer.
## Tests

```
npm test
```
