// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Same broken-row policy, same error records, same
// order — only faster: fields are sliced out of the text instead of built one
// character at a time, quoted fields are found with indexOf, and whole
// quote-free records are split natively. No dependencies, no state kept
// between calls, no clock, no randomness.
//
// Policy (mirrors csv-reader 1.0.0):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside is one quote, CRLF or a lone CR inside is read as LF; what
//   follows the closing quote up to the next comma or line break is appended
//   as it stands (quote_junk, when the field ends); a quote that never closes
//   is a literal character and the text after it is read again as unquoted
//   (unterminated_quote).
// - A quote inside an unquoted field is a literal character.
// - columns is the first record when header is true, else null; rows are the
//   records after it, each padded (short_row) or cut (long_row) to the first
//   record's width. Errors are {code, line, row} in the order met; line is
//   the 1-based line the record starts on, row its index in rows (null for
//   the header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** Scratch result of the unquoted scan (reused: no allocation per field). */
const UQ = { v: '', e: 0, p: 0, l: 0, a: 0 };

function finishUnq(init, parts, text, s, e) {
  const tail = text.slice(s, e);
  if (parts === null) return init === '' ? tail : init + tail;
  parts.push(tail);
  return init + parts.join('');
}

// Reads unquoted characters onto `init` up to the next comma or line break.
// A CR not followed by LF is dropped (stray_cr). Returns UQ:
// {v: value, e: COMMA|LINE_BREAK|END, p: next pos, l: line, a: chars kept}.
function scanUnq(text, pos, line, errors, recordLine, recordRow, init) {
  const len = text.length;
  let s = pos;
  let parts = null;
  let added = 0;
  while (pos < len) {
    const c = text.charCodeAt(pos);
    if (c === 44) {
      UQ.v = finishUnq(init, parts, text, s, pos);
      UQ.e = COMMA;
      UQ.p = pos + 1;
      UQ.l = line;
      UQ.a = added;
      return UQ;
    }
    if (c === 10) {
      UQ.v = finishUnq(init, parts, text, s, pos);
      UQ.e = LINE_BREAK;
      UQ.p = pos + 1;
      UQ.l = line + 1;
      UQ.a = added;
      return UQ;
    }
    if (c === 13) {
      if (text.charCodeAt(pos + 1) === 10) {
        UQ.v = finishUnq(init, parts, text, s, pos);
        UQ.e = LINE_BREAK;
        UQ.p = pos + 2;
        UQ.l = line + 1;
        UQ.a = added;
        return UQ;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (parts === null) parts = [];
      parts.push(text.slice(s, pos));
      pos += 1;
      s = pos;
      continue;
    }
    added += 1;
    pos += 1;
  }
  UQ.v = finishUnq(init, parts, text, s, pos);
  UQ.e = END;
  UQ.p = pos;
  UQ.l = line;
  UQ.a = added;
  return UQ;
}

/** Scratch result of the quoted-span build (reused). */
const QS = { v: '', l: 0 };

// Builds the value of a quoted field's span [start, close): "" collapses to
// one quote, CRLF and lone CR each become one LF. Counts line breaks into l.
function buildSpan(text, start, close, line) {
  const rIdx = text.indexOf('\r', start);
  const nIdx = text.indexOf('\n', start);
  if ((rIdx === -1 || rIdx >= close) && (nIdx === -1 || nIdx >= close)) {
    // No line break in the span: every quote in it is half of "", so one
    // native pass collapses them all.
    QS.v = text.slice(start, close).replaceAll('""', '"');
    QS.l = line;
    return QS;
  }
  // Rare path: the span holds a line break (a multi-line note) — walk it.
  const parts = [];
  let s = start;
  let i = start;
  while (i < close) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      // A quote inside the span is always the first half of "".
      parts.push(text.slice(s, i));
      parts.push('"');
      i += 2;
      s = i;
    } else if (c === 13) {
      parts.push(text.slice(s, i));
      parts.push('\n');
      line += 1;
      i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
      s = i;
    } else {
      if (c === 10) line += 1;
      i += 1;
    }
  }
  parts.push(text.slice(s, close));
  QS.v = parts.length === 1 ? parts[0] : parts.join('');
  QS.l = line;
  return QS;
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  const error = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record's line holds no quote at all, so no field can
    // span lines and every field is unquoted — split it natively.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    const qIdx = text.indexOf('"', pos);
    if (qIdx === -1 || qIdx >= end) {
      const rIdx = text.indexOf('\r', pos);
      let fields;
      if (rIdx === -1 || rIdx >= end) {
        fields = text.slice(pos, end).split(',');
      } else if (rIdx === end - 1 && nl !== -1) {
        // Only the CRLF's own CR.
        fields = text.slice(pos, end - 1).split(',');
      } else {
        // Stray CRs inside the line: one error each, dropped from the text.
        // The trailing CR of a CRLF line break is not stray.
        let strays = 0;
        let k = rIdx;
        while (k !== -1 && k < end) {
          strays += 1;
          k = text.indexOf('\r', k + 1);
        }
        if (nl !== -1 && end > pos && text.charCodeAt(end - 1) === 13) strays -= 1;
        for (let i = 0; i < strays; i++) error('stray_cr');
        fields = text.slice(pos, end).replaceAll('\r', '').split(',');
      }
      pos = nl === -1 ? len : nl + 1;
      line += 1;
      // A line that held only stray CRs is left with no characters: no record.
      if (fields.length === 1 && fields[0] === '') continue;
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
        continue;
      }
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    // General path: at least one quote on this line.
    const fields = [];
    let ended = COMMA;
    let quoted = false;
    while (ended === COMMA) {
      let value;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        // Find the closing quote: the first quote not doubled.
        let close = -1;
        let searchFrom = open + 1;
        let escaped = false;
        while (true) {
          const qq = text.indexOf('"', searchFrom);
          if (qq === -1) break;
          if (text.charCodeAt(qq + 1) === 34) {
            escaped = true;
            searchFrom = qq + 2;
            continue;
          }
          close = qq;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          error('unterminated_quote');
          const r = scanUnq(text, pos, line, errors, recordLine, recordRow, '"');
          value = r.v;
          ended = r.e;
          pos = r.p;
          line = r.l;
        } else {
          const rIdx = text.indexOf('\r', open + 1);
          if (!escaped && (rIdx === -1 || rIdx >= close)) {
            value = text.slice(open + 1, close);
            let k = text.indexOf('\n', open + 1);
            while (k !== -1 && k < close) {
              line += 1;
              k = text.indexOf('\n', k + 1);
            }
          } else {
            const b = buildSpan(text, open + 1, close, line);
            value = b.v;
            line = b.l;
          }
          pos = close + 1;
          if (pos >= len) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              const r = scanUnq(text, pos, line, errors, recordLine, recordRow, value);
              value = r.v;
              ended = r.e;
              pos = r.p;
              line = r.l;
              if (r.a > 0) error('quote_junk');
            }
          }
        }
      } else {
        quoted = false;
        // Inline unquoted scan (the hot path: ~90% of fields). A CR not
        // followed by LF is dropped (stray_cr); the field is sliced, not
        // built character by character.
        let s = pos;
        let parts = null;
        while (true) {
          if (pos >= len) {
            value = parts === null ? text.slice(s, pos) : parts.join('') + text.slice(s, pos);
            ended = END;
            break;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            value = parts === null ? text.slice(s, pos) : parts.join('') + text.slice(s, pos);
            pos += 1;
            ended = COMMA;
            break;
          }
          if (c === 10) {
            value = parts === null ? text.slice(s, pos) : parts.join('') + text.slice(s, pos);
            pos += 1;
            line += 1;
            ended = LINE_BREAK;
            break;
          }
          if (c === 13) {
            if (text.charCodeAt(pos + 1) === 10) {
              value = parts === null ? text.slice(s, pos) : parts.join('') + text.slice(s, pos);
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
              break;
            }
            error('stray_cr');
            if (parts === null) parts = [];
            parts.push(text.slice(s, pos));
            pos += 1;
            s = pos;
            continue;
          }
          pos += 1;
        }
      }
      fields.push(value);
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
