import { toCsv } from './csv.js';
import { isUniqueViolation, transaction } from './db.js';
import { HttpError } from './errors.js';
import { checkNewEntry, cleanName, nairaToKobo, nameKey, statusFor, withRunningBalance } from './ledger.js';
import { localTimestamp, nextDay, nextMonth, periodStarts } from './time.js';

const MAX_NAME = 80;
const MAX_PHONE = 30;
const MAX_SOURCE = 1000;
const MAX_BATCH = 20;

const ENTRY_COLUMNS = `
  e.id, e.customer_id AS customerId, e.kind, e.description,
  e.cost_kobo AS costKobo, e.paid_kobo AS paidKobo,
  e.voids_entry_id AS voidsEntryId, e.source_text AS sourceText, e.created_at AS createdAt,
  (SELECT v.id FROM entries v WHERE v.voids_entry_id = e.id) AS voidedById`;

const CUSTOMER_TOTALS = `
  SELECT c.id, c.name, c.phone,
    COALESCE(SUM(e.cost_kobo), 0) - COALESCE(SUM(e.paid_kobo), 0) AS balanceKobo,
    COALESCE(SUM(e.paid_kobo), 0) AS paidKobo,
    MAX(e.created_at) AS lastEntryAt
  FROM customers c
  LEFT JOIN entries e ON e.customer_id = c.id`;

const KIND_LABELS = { SALE: 'Sale', PAYMENT: 'Payment', VOID: 'Cancellation' };

const withStatus = (customer) => ({ ...customer, status: statusFor(customer.balanceKobo, customer.paidKobo) });

function customerFields(input) {
  const name = cleanName(input.name);
  const phone = String(input.phone ?? '').trim();
  if (!name) throw new HttpError(400, "Enter the customer's name.");
  if (name.length > MAX_NAME) throw new HttpError(400, 'That name is too long.');
  if (phone.length > MAX_PHONE || !/^[+\d\s()-]*$/.test(phone)) {
    throw new HttpError(400, 'Enter the phone number using digits only.');
  }
  return { name, key: nameKey(name), phone };
}

function duplicateName(error, name) {
  return isUniqueViolation(error) ? new HttpError(409, `There is already a customer called ${name}.`) : error;
}

function sourceText(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, MAX_SOURCE) : '';
  return text || null;
}

export function createStore(db, { timeZone }) {
  const now = () => localTimestamp(timeZone);

  const sql = {
    customers: db.prepare(`${CUSTOMER_TOTALS} GROUP BY c.id ORDER BY balanceKobo DESC, c.name COLLATE NOCASE`),
    customer: db.prepare(`${CUSTOMER_TOTALS} WHERE c.id = ? GROUP BY c.id`),
    customerExists: db.prepare('SELECT 1 AS found FROM customers WHERE id = ?'),
    customerByKey: db.prepare('SELECT id, name FROM customers WHERE name_key = ?'),
    customerNames: db.prepare('SELECT name FROM customers ORDER BY name COLLATE NOCASE'),
    insertCustomer: db.prepare('INSERT INTO customers (name, name_key, phone, created_at) VALUES (?, ?, ?, ?)'),
    updateCustomer: db.prepare('UPDATE customers SET name = ?, name_key = ?, phone = ? WHERE id = ?'),
    balance: db.prepare('SELECT COALESCE(SUM(cost_kobo) - SUM(paid_kobo), 0) AS kobo FROM entries WHERE customer_id = ?'),
    entries: db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries e WHERE e.customer_id = ? ORDER BY e.id`),
    entry: db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries e WHERE e.id = ?`),
    insertEntry: db.prepare(`
      INSERT INTO entries (customer_id, kind, description, cost_kobo, paid_kobo, voids_entry_id, source_text, created_at)
      VALUES (@customerId, @kind, @description, @costKobo, @paidKobo, @voidsEntryId, @sourceText, @createdAt)`),
    totalsSince: db.prepare(`
      SELECT COALESCE(SUM(paid_kobo), 0) AS paid, COALESCE(SUM(cost_kobo), 0) AS cost
      FROM entries WHERE created_at >= ?`),
    recent: db.prepare(`
      SELECT ${ENTRY_COLUMNS}, c.name AS customerName
      FROM entries e JOIN customers c ON c.id = e.customer_id
      ORDER BY e.id DESC LIMIT ?`),
    dayTotals: db.prepare(`
      SELECT substr(created_at, 1, 10) AS date,
        COALESCE(SUM(paid_kobo), 0) AS receivedKobo,
        COALESCE(SUM(cost_kobo), 0) AS salesKobo,
        COUNT(*) AS entryCount
      FROM entries WHERE created_at >= ? AND created_at < ?
      GROUP BY date ORDER BY date`),
    entriesBetween: db.prepare(`
      SELECT ${ENTRY_COLUMNS}, c.name AS customerName
      FROM entries e JOIN customers c ON c.id = e.customer_id
      WHERE e.created_at >= ? AND e.created_at < ?
      ORDER BY e.id`),
    allEntries: db.prepare(`
      SELECT ${ENTRY_COLUMNS}, c.name AS customerName
      FROM entries e JOIN customers c ON c.id = e.customer_id
      ORDER BY e.id`),
  };

  const balanceOf = (customerId) => sql.balance.get(customerId).kobo;

  function resolveCustomer(item, createdAt) {
    if (item.customerId != null) {
      if (!Number.isSafeInteger(item.customerId) || !sql.customerExists.get(item.customerId)) {
        throw new HttpError(404, 'That customer could not be found.');
      }
      return item.customerId;
    }
    const { name, key } = customerFields({ name: item.customerName });
    const existing = sql.customerByKey.get(key);
    if (existing) return existing.id;
    return Number(sql.insertCustomer.run(name, key, '', createdAt).lastInsertRowid);
  }

  const insertEntries = transaction(db, (items) => {
    const createdAt = now();
    return items.map((item, index) => {
      try {
        const customerId = resolveCustomer(item, createdAt);
        const entry = checkNewEntry(item, balanceOf(customerId));
        const result = sql.insertEntry.run({
          ...entry,
          customerId,
          voidsEntryId: null,
          sourceText: sourceText(item.sourceText),
          createdAt,
        });
        return Number(result.lastInsertRowid);
      } catch (error) {
        if (items.length > 1 && error instanceof HttpError) {
          throw new HttpError(error.status, `Entry ${index + 1}: ${error.message}`);
        }
        throw error;
      }
    });
  });

  const insertVoid = transaction(db, (id) => {
    const entry = sql.entry.get(id);
    if (!entry) throw new HttpError(404, 'That entry could not be found.');
    if (entry.kind === 'VOID') throw new HttpError(400, 'A cancellation cannot be cancelled.');
    if (entry.voidedById) throw new HttpError(409, 'This entry is already cancelled.');

    const result = sql.insertEntry.run({
      customerId: entry.customerId,
      kind: 'VOID',
      description: `Cancelled: ${entry.description}`,
      costKobo: -entry.costKobo,
      paidKobo: -entry.paidKobo,
      voidsEntryId: entry.id,
      sourceText: null,
      createdAt: now(),
    });
    return { id: Number(result.lastInsertRowid), customerId: entry.customerId };
  });

  const listCustomers = () => sql.customers.all().map(withStatus);

  return {
    listCustomers,

    customerNames: () => sql.customerNames.all().map((row) => row.name),

    getCustomer(id) {
      const customer = sql.customer.get(id);
      if (!customer) throw new HttpError(404, 'That customer could not be found.');
      return { customer: withStatus(customer), entries: withRunningBalance(sql.entries.all(id)) };
    },

    createCustomer(input) {
      const { name, key, phone } = customerFields(input);
      try {
        const result = sql.insertCustomer.run(name, key, phone, now());
        return { id: Number(result.lastInsertRowid), name, phone };
      } catch (error) {
        throw duplicateName(error, name);
      }
    },

    updateCustomer(id, input) {
      const { name, key, phone } = customerFields(input);
      try {
        if (sql.updateCustomer.run(name, key, phone, id).changes === 0) {
          throw new HttpError(404, 'That customer could not be found.');
        }
        return { id, name, phone };
      } catch (error) {
        throw duplicateName(error, name);
      }
    },

    addEntries(items) {
      if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'There is nothing to save.');
      if (items.length > MAX_BATCH) throw new HttpError(400, `Save at most ${MAX_BATCH} entries at a time.`);
      return insertEntries(items);
    },

    voidEntry: (id) => insertVoid(id),

    summary() {
      const owing = listCustomers().filter((customer) => customer.balanceKobo > 0);
      const periods = periodStarts(timeZone);
      const today = sql.totalsSince.get(periods.today);
      const week = sql.totalsSince.get(periods.week);
      const month = sql.totalsSince.get(periods.month);

      return {
        owedKobo: owing.reduce((sum, customer) => sum + customer.balanceKobo, 0),
        owingCount: owing.length,
        receivedTodayKobo: today.paid,
        receivedWeekKobo: week.paid,
        receivedMonthKobo: month.paid,
        salesMonthKobo: month.cost,
        topOwing: owing.slice(0, 5),
        recent: sql.recent.all(8).map((row) => ({ ...row })),
      };
    },

    month(month = periodStarts(timeZone).today.slice(0, 7)) {
      const days = sql.dayTotals.all(`${month}-01`, `${nextMonth(month)}-01`).map((row) => ({ ...row }));
      return {
        month,
        today: periodStarts(timeZone).today,
        receivedKobo: days.reduce((sum, day) => sum + day.receivedKobo, 0),
        salesKobo: days.reduce((sum, day) => sum + day.salesKobo, 0),
        days,
      };
    },

    day(date) {
      const entries = sql.entriesBetween.all(date, nextDay(date)).map((row) => ({ ...row }));
      return {
        date,
        receivedKobo: entries.reduce((sum, entry) => sum + entry.paidKobo, 0),
        salesKobo: entries.reduce((sum, entry) => sum + entry.costKobo, 0),
        entries,
      };
    },

    draftsFrom(events, text) {
      return events.map((event) => {
        const kind = event.kind === 'SALE' || event.kind === 'PAYMENT' ? event.kind : 'OTHER';
        const name = cleanName(event.customer_name);
        const match = name ? sql.customerByKey.get(nameKey(name)) : undefined;
        const balanceKobo = match ? balanceOf(match.id) : 0;
        const notes = event.needs_review && event.review_reason ? [event.review_reason] : [];
        let paidKobo = nairaToKobo(event.amount_paid);

        if (kind === 'PAYMENT' && event.clears_balance) {
          if (balanceKobo > 0) paidKobo = balanceKobo;
          else notes.push(`${match?.name ?? (name || 'This customer')} does not owe anything.`);
        }

        return {
          kind,
          customerName: match?.name ?? name,
          description: String(event.description ?? '').trim(),
          costKobo: kind === 'SALE' ? nairaToKobo(event.total_cost) : null,
          paidKobo: paidKobo ?? (kind === 'SALE' ? 0 : null),
          note: notes.join(' '),
          sourceText: text,
        };
      });
    },

    exportCsv() {
      const balances = new Map();
      const rows = sql.allEntries.all().map((entry) => {
        const balance = (balances.get(entry.customerId) ?? 0) + entry.costKobo - entry.paidKobo;
        balances.set(entry.customerId, balance);
        return [
          entry.createdAt,
          entry.customerName,
          KIND_LABELS[entry.kind],
          entry.description,
          entry.costKobo / 100,
          entry.paidKobo / 100,
          balance / 100,
          entry.voidedById ? 'Yes' : '',
          entry.sourceText ?? '',
        ];
      });
      return toCsv([
        ['Date', 'Customer', 'Type', 'Description', 'Price (NGN)', 'Paid (NGN)', 'Balance after (NGN)', 'Cancelled', 'Recorded as'],
        ...rows,
      ]);
    },
  };
}
