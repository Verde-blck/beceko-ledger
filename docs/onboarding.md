# Setting up a new business

Each business gets its own copy of the app on Railway: its own service, volume, PIN and brand. All copies run from the same GitHub repo, so one push updates every business.

## 1. Brand

1. Get the business's logo and the name they want on the app.
2. Copy `brands/iwe-oja` to `brands/<their-name>` (lower case, hyphens, for example `mama-tola`).
3. Edit `brand.json` and replace the icons with ones made from their logo. `brands/README.md` lists the sizes.
4. Commit and push.

## 2. Railway

1. In your Railway project, create a new service from the same GitHub repo.
2. Add a volume to the service, mounted at `/data`.
3. Set the variables:

   ```
   BRAND=<their-name>
   BUSINESS_NAME=<their full business name, used on statements and reminders>
   LEDGER_PIN=<4 to 8 digits>
   SESSION_SECRET=<new random secret; never reuse another business's>
   DATABASE_FILE=/data/ledger.db
   COOKIE_SECURE=true
   TRUST_PROXY=true
   GEMINI_API_KEY=<paid-tier key>
   GEMINI_MODEL=<the model that works>
   PAID_UNTIL=<last paid day, YYYY-MM-DD>
   RENEW_CONTACT=<how to pay you, shown when the subscription ends>
   STATEMENT_NOTE=<their bank details or phone number, optional>
   ```

4. Generate a domain, or add `<their-name>.<your domain>` as a custom domain and create the DNS record Railway shows you.
5. Check the deploy log says `running` with the right brand and the right paid-until date.

## 3. Handover

1. Open their address, sign in with the PIN, and record and cancel a test sale.
2. Send them the address and the PIN separately.
3. Show them how to add it to the home screen.

## Renewals

When a business pays, change its `PAID_UNTIL` to the new last paid day. Railway redeploys the service, and the app unlocks straight away if it was locked.

- Up to 7 days before `PAID_UNTIL`: a reminder shows at the top of the app.
- For 7 days after `PAID_UNTIL` (set with `GRACE_DAYS`): everything still works, with a warning to renew.
- After that: the app is locked. They can still sign in, read how to renew and download all their records. Nothing is deleted.

Leave `PAID_UNTIL` empty for a copy that should never lock, such as BECEKO's.
