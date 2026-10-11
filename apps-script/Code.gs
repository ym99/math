/**
 * Email + solution server for index.html (long multiplication practice).
 *
 * Runs as a Google Apps Script web app under YOUR Google account:
 *   - mail goes out through your Gmail (free, ~100 emails/day),
 *   - the solving code lives here, never in the browser, so the solution can
 *     only be obtained by a request that has already emailed the parent.
 *
 * Setup (once):
 *   1. Go to https://script.google.com -> New project.
 *   2. Replace the contents of Code.gs with this file. Set PARENT_EMAIL below.
 *   3. Deploy -> New deployment -> type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Click Deploy and allow the permissions (send email as you).
 *   4. Copy the Web app URL (ends with /exec) into API_URL in index.html.
 *   After editing this file later: Deploy -> Manage deployments -> Edit ->
 *   Version: New version -> Deploy (the URL stays the same).
 */

const PARENT_EMAIL = 'you@example.com';   // <-- the parent's address
const MAX_INPUT_LENGTH = 30;              // digits are cheap, but not unlimited

// ---------------------------------------------------------------------------
// HTTP entry points
// ---------------------------------------------------------------------------

/** Step 0: tells the page the server works. The address is never sent out. */
function doGet() {
  return json_({ ok: true });
}

/** Step 1: the student's attempt. */
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'submit') return json_(submit_(req));
    throw new Error('Unknown action.');
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Emails the attempt, verdict and full worked solution to the parent FIRST.
 * Only if Gmail accepted the message does the function go on to return the
 * solution to the page.
 */
function submit_(req) {
  const x = parseNumber_(req.x, 'x');
  const y = parseNumber_(req.y, 'y');
  const answer = parseNumber_(req.answer, 'the answer');

  const work = solve_(x, y);
  const correct = canonical_(answer.neg, answer.digits, answer.frac.length) ===
                  canonical_(work.result.neg, work.result.digits, work.result.frac);
  const verdict = correct ? 'CORRECT ✔' : 'INCORRECT ✘';

  // Throws on any failure (bad address, quota exceeded, ...), in which case
  // the error goes back to the page and no solution is returned.
  MailApp.sendEmail({
    to: PARENT_EMAIL,
    subject: `Math: ${work.problem} — ${verdict}`,
    htmlBody:
      `<p style="font-size:18px;margin:0 0 12px">` +
      `<b style="color:${correct ? '#1a7f37' : '#cf222e'}">${verdict}</b></p>` +
      table_([
        ['Problem', work.problem],
        ['Answer typed', answer.text],
        ['Correct result', work.resultText],
        ['Time', new Date().toString()],
      ]) +
      `<p style="margin:20px 0 8px;color:#666">Worked solution (shown to the student now):</p>` +
      workHtml_(work.layout) +
      `<p style="color:#666;font-family:monospace">${escape_(work.placesText)}</p>`,
  });

  return { ok: true, work, answer: answer.text, correct };
}

function table_(rows) {
  return '<table cellpadding="4" style="border-collapse:collapse;font-family:monospace">' +
    rows.map(([k, v]) =>
      `<tr><td style="color:#666">${escape_(k)}</td><td><b>${escape_(v)}</b></td></tr>`).join('') +
    '</table>';
}

/**
 * The worked solution as an email-safe table: one column per digit with a
 * narrow column between digits that holds the decimal point, so the digits
 * stay aligned and the point is a real dot (email clients ignore the CSS
 * positioning the web page uses).
 */
function workHtml_(layout) {
  const DIGIT = 'width:20px;text-align:center;padding:2px 0;';
  const GAP = 'width:6px;padding:0;text-align:center;color:#e0352b;font-weight:bold;';
  const COLOR = { partial: '#0b7d8c', op: '#888888' };
  const cols = layout.width;   // digit columns, after the operator column

  let html = '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;' +
             'font-family:Consolas,\'Courier New\',monospace;font-size:24px;color:#1d1d1f">';
  for (const r of layout.rows) {
    html += '<tr>';
    if (r.rule) {
      // a horizontal line under the last r.rule digit columns
      html += `<td style="${DIGIT}"></td>`;
      for (let j = 0; j < cols; j++) {
        const on = j >= cols - r.rule;
        const line = on ? 'border-top:3px solid #1d1d1f;' : '';
        html += `<td style="${GAP}${j > cols - r.rule ? line : ''}"></td>` +
                `<td style="${DIGIT}${line}"></td>`;
      }
      html += '<td></td>';
    } else {
      html += `<td style="${DIGIT}color:${COLOR.op}">${escape_(r.op || '')}</td>`;
      const pad = cols - r.cells.length;
      for (let j = 0; j < cols; j++) {
        const c = j >= pad ? r.cells[j - pad] : null;
        const prev = j - 1 >= pad ? r.cells[j - 1 - pad] : null;
        const color = c && COLOR[c.cls] ? `color:${COLOR[c.cls]};` : '';
        html += `<td style="${GAP}">${prev && prev.dot ? '.' : ''}</td>` +
                `<td style="${DIGIT}${color}">${escape_(c ? c.ch : '')}</td>`;
      }
      html += `<td style="padding-left:16px;font-size:13px;color:#888;white-space:nowrap">` +
              `${escape_(r.note || '')}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table>';
}

function escape_(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/** Splits a typed number into sign, whole part and fractional part, keeping
 *  the digits exactly as typed (so "2.50" has two decimal places). */
function parseNumber_(input, name) {
  const t = String(input == null ? '' : input).trim().replace(',', '.');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] + (m[3] || '')) === '' || t.length > MAX_INPUT_LENGTH) {
    throw new Error(`"${input}" is not a valid number for ${name}.`);
  }
  const whole = m[2].replace(/^0+/, '') || '0';
  const frac = m[3] || '';
  const digits = whole + frac;
  return {
    neg: m[1] === '-',
    whole, frac, digits,
    value: BigInt(digits),
    text: (m[1] === '-' ? '-' : '') + whole + (frac ? '.' + frac : ''),
  };
}

/** School-style long multiplication, returned as plain data for the page. */
function solve_(a, b) {
  const fracCount = a.frac.length + b.frac.length;
  const product = a.value * b.value;
  const neg = a.neg !== b.neg && product !== BigInt(0);   // no 0n literal: the Apps Script parser rejects it

  // One row per significant digit of y (no rows for leading zeros like the
  // "0" in 0.25), each row shifted one more place to the left.
  const multiplier = b.value.toString();
  const xText = a.value.toString();
  const partials = [];
  for (let i = 0; i < multiplier.length; i++) {
    const d = Number(multiplier[multiplier.length - 1 - i]);
    partials.push({
      digits: d === 0 ? '0'.repeat(xText.length) : (a.value * BigInt(d)).toString(),
      shift: i,
      note: `${xText} × ${d}` + (i ? `, shifted ${i} place${i > 1 ? 's' : ''}` : ''),
    });
  }

  // The result needs at least one whole digit in front of the decimal places.
  const resultDigits = product.toString().padStart(fracCount + 1, '0');
  const result = { neg, digits: resultDigits, frac: fracCount };
  const f = fracCount;

  return {
    result,
    resultText: format_(neg, resultDigits, fracCount),
    problem: `${a.text} × ${b.text}`,
    layout: layout_(
      { neg: a.neg, digits: a.digits, frac: a.frac.length },
      { neg: b.neg, digits: b.digits, frac: b.frac.length },
      partials, result),
    placesText: `Decimal places: ${a.frac.length} (x) + ${b.frac.length} (y) = ${f}` +
                ` → the point goes ${f} digit${f === 1 ? '' : 's'} from the right.`,
  };
}

/**
 * Lays the work out as rows of right-aligned character cells, shared by the
 * web page and the email:
 *   { width, rows: [ {op, cells: [{ch, cls, dot}], note} | {rule: n} ] }
 * `dot` marks the cell that the decimal point follows; `rule: n` is a line
 * under the last n columns; `width` is the number of columns after `op`.
 */
function layout_(x, y, partials, result) {
  const xCells = numberCells_(x);
  const yCells = numberCells_(y);
  const resultCells = numberCells_(result);
  const rows = [
    { cells: xCells },
    { op: '×', cells: yCells },
    { rule: Math.max(xCells.length, yCells.length) },
  ];

  if (partials.length === 1) {
    // A one-digit multiplier: its only row already is the answer.
    rows.push({ cells: resultCells, note: '← ' + partials[0].note });
  } else {
    let workLen = resultCells.length;
    partials.forEach((p, i) => {
      const cells = [...p.digits].map(ch => ({ ch, cls: 'partial' }));
      for (let s = 0; s < p.shift; s++) cells.push({ ch: '' });
      workLen = Math.max(workLen, cells.length);
      rows.push({ op: i === partials.length - 1 ? '+' : '', cells, note: '← ' + p.note });
    });
    rows.push({ rule: workLen });
    rows.push({ cells: resultCells, note: '← sum of the rows' });
  }

  return { width: Math.max(...rows.map(r => r.rule || r.cells.length)), rows };
}

/** Cells for a number; the dot follows the last whole-part digit. */
function numberCells_(n) {
  const cells = [];
  if (n.neg) cells.push({ ch: '-' });
  const lastWhole = n.digits.length - n.frac - 1;
  [...n.digits].forEach((ch, i) => cells.push({ ch, dot: n.frac > 0 && i === lastWhole }));
  return cells;
}

function format_(neg, digits, frac) {
  const w = digits.length - frac;
  return (neg ? '-' : '') + digits.slice(0, w) + (frac ? '.' + digits.slice(w) : '');
}

/** A canonical spelling of a value: 040.6250 and 40.625 compare equal. */
function canonical_(neg, digits, frac) {
  const w = digits.length - frac;
  const whole = digits.slice(0, w).replace(/^0+/, '') || '0';
  const f = digits.slice(w).replace(/0+$/, '');
  const zero = whole === '0' && f === '';
  return (neg && !zero ? '-' : '') + whole + (f ? '.' + f : '');
}
