import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const asset = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const FONTS = { regular: asset('assets/fonts/Lexend-Regular.ttf'), bold: asset('assets/fonts/Lexend-SemiBold.ttf') };
const MARK = asset('public/icons/icon-192.png');

const INK = '#1d2b53';
const SOFT = '#55628a';
const RULE = '#d5e0ee';
const MARGIN_RED = '#d2373c';
const OWED = '#b3262b';
const PAID = '#0b7a4b';

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const COLUMNS = [
  { key: 'date', label: 'Date', width: 72 },
  { key: 'description', label: 'Details', width: CONTENT_WIDTH - 72 - 3 * 76 },
  { key: 'charge', label: 'Charged', width: 76, align: 'right' },
  { key: 'paid', label: 'Paid', width: 76, align: 'right' },
  { key: 'balance', label: 'Balance', width: 76, align: 'right' },
];

const wholeNaira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const exactNaira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const naira = (kobo) => ((kobo || 0) % 100 === 0 ? wholeNaira : exactNaira).format((kobo || 0) / 100);

const longDate = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function balanceSummary(balanceKobo) {
  if (balanceKobo > 0) return { label: 'Balance due', amount: naira(balanceKobo), colour: OWED };
  if (balanceKobo < 0) return { label: 'In credit', amount: naira(-balanceKobo), colour: PAID };
  return { label: 'Balance due', amount: 'Paid in full', colour: PAID };
}

function header(doc, statement, businessName) {
  const top = PAGE.margin;
  doc.image(MARK, PAGE.margin, top - 4, { width: 44 });
  doc.font('bold').fontSize(17).fillColor(INK).text(businessName, PAGE.margin + 56, top, { width: 300 });
  doc.font('regular').fontSize(10).fillColor(SOFT).text('Statement of account', PAGE.margin + 56, doc.y + 1);

  doc.font('regular').fontSize(9).fillColor(SOFT).text('Date issued', PAGE.margin, top + 2, { width: CONTENT_WIDTH, align: 'right' });
  doc.font('bold').fontSize(11).fillColor(INK).text(longDate(statement.issuedOn), PAGE.margin, top + 15, { width: CONTENT_WIDTH, align: 'right' });

  const ruleY = top + 58;
  doc.moveTo(PAGE.margin, ruleY).lineTo(PAGE.width - PAGE.margin, ruleY).lineWidth(1.5).strokeColor(MARGIN_RED).stroke();
  return ruleY + 20;
}

function customerAndTotals(doc, statement, y) {
  doc.font('regular').fontSize(9).fillColor(SOFT).text('Prepared for', PAGE.margin, y);
  doc.font('bold').fontSize(15).fillColor(INK).text(statement.customer.name, PAGE.margin, y + 13, { width: 240 });
  if (statement.customer.phone) {
    doc.font('regular').fontSize(10).fillColor(SOFT).text(statement.customer.phone, PAGE.margin, doc.y + 2, { width: 240 });
  }
  const leftBottom = doc.y;

  const balance = balanceSummary(statement.balanceKobo);
  const boxes = [
    { label: 'Total charged', amount: naira(statement.chargedKobo), colour: INK },
    { label: 'Total paid', amount: naira(statement.paidKobo), colour: INK },
    balance,
  ];
  const boxWidth = 92;
  let x = PAGE.width - PAGE.margin - boxWidth * boxes.length;
  for (const box of boxes) {
    doc.font('regular').fontSize(9).fillColor(SOFT).text(box.label, x, y, { width: boxWidth - 6, align: 'right' });
    doc.font('bold').fontSize(box === balance ? 14 : 12).fillColor(box.colour).text(box.amount, x, y + 13, { width: boxWidth - 6, align: 'right' });
    x += boxWidth;
  }
  return Math.max(leftBottom, y + 34) + 24;
}

function tableHeader(doc, y) {
  let x = PAGE.margin;
  doc.font('bold').fontSize(9).fillColor(SOFT);
  for (const column of COLUMNS) {
    doc.text(column.label, x, y, { width: column.width - (column.align ? 0 : 8), align: column.align ?? 'left' });
    x += column.width;
  }
  const ruleY = y + 15;
  doc.moveTo(PAGE.margin, ruleY).lineTo(PAGE.width - PAGE.margin, ruleY).lineWidth(1.2).strokeColor(RULE).stroke();
  return ruleY + 7;
}

function row(doc, line, y) {
  const cells = {
    date: shortDate(line.date),
    description: line.description,
    charge: line.chargeKobo ? naira(line.chargeKobo) : '',
    paid: line.paidKobo ? naira(line.paidKobo) : '',
    balance: naira(line.balanceKobo),
  };
  doc.font('regular').fontSize(10);
  const height = Math.max(...COLUMNS.map((c) => doc.heightOfString(cells[c.key], { width: c.width - (c.align ? 0 : 8) })));

  let x = PAGE.margin;
  for (const column of COLUMNS) {
    const isBalance = column.key === 'balance';
    doc
      .font(isBalance ? 'bold' : 'regular')
      .fillColor(isBalance && line.balanceKobo > 0 ? OWED : column.key === 'paid' ? PAID : INK)
      .text(cells[column.key], x, y, { width: column.width - (column.align ? 0 : 8), align: column.align ?? 'left' });
    x += column.width;
  }
  const ruleY = y + height + 6;
  doc.moveTo(PAGE.margin, ruleY).lineTo(PAGE.width - PAGE.margin, ruleY).lineWidth(0.6).strokeColor(RULE).stroke();
  return ruleY + 7;
}

function footer(doc, { businessName, issuedOn }) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const y = PAGE.height - PAGE.margin + 14;
    doc.font('regular').fontSize(8).fillColor(SOFT);
    doc.text(`${businessName} · ${longDate(issuedOn)}`, PAGE.margin, y, { width: CONTENT_WIDTH / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE.width / 2, y, { width: CONTENT_WIDTH / 2, align: 'right', lineBreak: false });
  }
}

export function statementPdf(statement, { businessName, note }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    info: { Title: `Statement for ${statement.customer.name}`, Author: businessName },
  });
  doc.registerFont('regular', FONTS.regular);
  doc.registerFont('bold', FONTS.bold);

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageBottom = PAGE.height - PAGE.margin - 24;
  let y = customerAndTotals(doc, statement, header(doc, statement, businessName));

  if (statement.lines.length === 0) {
    doc.font('regular').fontSize(11).fillColor(SOFT).text('There are no transactions to show.', PAGE.margin, y);
    y = doc.y + 16;
  } else {
    y = tableHeader(doc, y);
    for (const line of statement.lines) {
      doc.font('regular').fontSize(10);
      const needed = doc.heightOfString(line.description, { width: COLUMNS[1].width - 8 }) + 14;
      if (y + needed > pageBottom) {
        doc.addPage();
        y = tableHeader(doc, PAGE.margin);
      }
      y = row(doc, line, y);
    }
  }

  const closing = [note, 'Thank you for your custom.'].filter(Boolean);
  doc.font('regular').fontSize(10);
  const closingHeight = closing.reduce((sum, text) => sum + doc.heightOfString(text, { width: CONTENT_WIDTH }) + 6, 0);
  if (y + 14 + closingHeight > pageBottom) {
    doc.addPage();
    y = PAGE.margin;
  }
  y += 14;
  if (note) {
    doc.font('bold').fontSize(10).fillColor(INK).text(note, PAGE.margin, y, { width: CONTENT_WIDTH });
    y = doc.y + 6;
  }
  doc.font('regular').fontSize(10).fillColor(SOFT).text('Thank you for your custom.', PAGE.margin, y, { width: CONTENT_WIDTH });

  footer(doc, { businessName, issuedOn: statement.issuedOn });
  doc.end();
  return finished;
}
