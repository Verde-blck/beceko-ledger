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

## How the money is kept

Amounts are stored in kobo as whole numbers, so balances never drift. Entries cannot be edited or deleted; the database itself refuses. To fix a mistake, use "Cancel entry" on the customer's page. That adds a cancelling line, crosses out the original and corrects the balance, so the full history stays readable.

## Hosting

Any host that runs Node and keeps files on disk between restarts will do: a small VPS, or a platform such as Railway, Render or Fly with a persistent volume. Hosts without a persistent disk will lose the data on restart.

Serve it over HTTPS and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.

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
