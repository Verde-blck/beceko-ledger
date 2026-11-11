# Beceko Ledger

Keeps track of Beceko's customers: what each person bought, what they paid, and what they still owe.

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

With `GEMINI_API_KEY` set, the home page has a box where you can type or speak notes such as "Mama Chidi paid 5k for her lace". The app reads the note, fills in the details and waits for you to check them. Nothing is saved until you press Save. Everything can also be recorded by hand from the customer's page, with or without a key.

Speaking uses the browser's built-in speech recognition. It works in Chrome on Android.

To test the key and model on their own, run:

```
npm run check-gemini
```

It sends a test note through the same request quick entry uses and shows how Gemini read it. If the model in `GEMINI_MODEL` does not work, it tries the newest Flash models your key can use and tells you which one to put in `.env`.

## Adding it to the home screen

The app has its own icon, made from the Beceko logo, and opens full screen without the browser bar.

- Android (Chrome): open the link, tap the menu, then "Add to home screen" or "Install app".
- iPhone (Safari): open the link, tap Share, then "Add to Home Screen".

Sign in once inside the home-screen version. If a shortcut was added before the icon existed, remove it and add it again, because phones keep the old icon.

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

The whole ledger lives in `data/ledger.db`. Back it up regularly with:

```
sqlite3 data/ledger.db ".backup ledger-backup.db"
```

Copying the file directly while the app is running can miss recent entries. The home page also has a link to download every record as a spreadsheet.

## Tests

```
npm test
```
