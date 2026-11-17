# The admin dashboard

One page that shows every business: whether it is paid up, in its grace week or locked, when it was last backed up and last used, and which version it runs. From there you can extend a subscription by a month, three months or a year, set an exact date, suspend or resume a business, or make one never lock.

Changes take effect straight away, without a redeploy, because the dashboard talks to each business's copy directly. A date set here replaces the copy's `PAID_UNTIL` variable from then on.

The dashboard never sees customer records. It only reads counts and dates, and can only change the subscription.

## Setting it up on Railway

1. In your Railway project, create a new service from the same GitHub repo.
2. In its Settings, set the **Custom Start Command** to `npm run admin`.
3. Set its variables:

   ```
   ADMIN_PASSWORD=<at least 10 characters, only for you>
   SESSION_SECRET=<new random secret>
   OPERATOR_SECRET=<another new random secret; never change it once businesses are connected>
   BUSINESSES=beceko=https://beceko-ledger-production.up.railway.app
   COOKIE_SECURE=true
   TRUST_PROXY=true
   ```

   Generate each secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The dashboard needs no volume.
4. Generate a domain for it and open it. Sign in with `ADMIN_PASSWORD`.

## Connecting a business

1. Add it to `BUSINESSES`, separated by commas: `id=address`, where the id is the business's brand folder name, for example `beceko=https://...,mama-tola=https://...`.
2. On the dashboard, open the business's **More** menu (or the link on its card if it is not connected yet) and click **Show its ADMIN_TOKEN**.
3. In that business's service, set `ADMIN_TOKEN` to that value. The copy's log then says `The admin dashboard can connect to this copy.`

Each business has its own token, worked out from `OPERATOR_SECRET` and the business id, so one leaked token cannot be used on another business. If you ever change `OPERATOR_SECRET`, every business's token changes and each needs its new one.

## If a card says "Not connected"

- **Could not be reached:** the address in `BUSINESSES` is wrong, or the service is down.
- **Did not answer in time:** it was probably asleep. Refresh in a moment.
- **ADMIN_TOKEN does not match:** copy the token again from its token page.
- **Admin connection not set up:** that copy has no `ADMIN_TOKEN` yet, or it runs a version older than 1.8.0.
