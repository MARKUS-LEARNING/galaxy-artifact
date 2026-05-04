// ─── XML parser ───
//
// Two-stage XML support:
//   1) Apple Music / iTunes "Library.xml" plist files — parsed via
//      a dedicated plist walker that knows about <key>/<value> pairs
//      and the canonical <plist><dict><key>Tracks</key><dict>...</dict>
//      shape.
//   2) Generic XML — auto-detect the most common repeating child
//      element under the document root (one or two levels deep) and
//      treat each occurrence as a row, with child element names and
//      attribute names becoming column headers.
//
// Both paths emit the same { headers, rows } shape that parseCSV
// produces, so downstream rendering doesn't care which format the
// user uploaded.

// Walk one plist <dict> element, returning the parsed key/value
// object. Nested <dict> and <array> values (playlists, etc.) are
// skipped — we only care about scalar fields.
function parsePlistDict(dictEl) {
  const obj = {};
  const children = dictEl.children;
  for (let i = 0; i < children.length - 1; i++) {
    if (children[i].tagName === 'key') {
      const key = children[i].textContent;
      const val = children[i + 1];
      const tag = val.tagName;
      if (tag === 'string' || tag === 'integer' || tag === 'real') {
        obj[key] = val.textContent;
      } else if (tag === 'true') {
        obj[key] = 'true';
      } else if (tag === 'false') {
        obj[key] = 'false';
      } else if (tag === 'date') {
        obj[key] = val.textContent;
      }
      // skip nested dict/array values (playlists, etc.)
      i++; // advance past value
    }
  }
  return obj;
}

// Top-level Apple Music / iTunes plist parser. Returns { headers, rows }
// or null if the document doesn't match the expected plist shape (caller
// then falls back to the generic XML walker).
function parsePlistTracks(doc) {
  // Structure: <plist><dict> ... <key>Tracks</key><dict> <key>ID</key><dict>track</dict> ... </dict>
  const root = doc.documentElement; // <plist>
  const topDict = root.querySelector(':scope > dict');
  if (!topDict) return null;

  // Find the "Tracks" dict
  let tracksDict = null;
  const topChildren = topDict.children;
  for (let i = 0; i < topChildren.length - 1; i++) {
    if (topChildren[i].tagName === 'key' && topChildren[i].textContent === 'Tracks') {
      const next = topChildren[i + 1];
      if (next.tagName === 'dict') tracksDict = next;
      break;
    }
  }
  if (!tracksDict) return null;

  // Each track: <key>ID</key><dict>...</dict>
  const rows = [];
  const headerSet = new Set();
  const trackChildren = tracksDict.children;
  for (let i = 0; i < trackChildren.length - 1; i++) {
    if (trackChildren[i].tagName === 'key') {
      const next = trackChildren[i + 1];
      if (next.tagName === 'dict') {
        const track = parsePlistDict(next);
        for (const k of Object.keys(track)) headerSet.add(k);
        rows.push(track);
      }
      i++; // advance past value
    }
  }
  if (!rows.length) return null;

  // Prioritize useful columns for the visualizer
  const priority = ['Name', 'Artist', 'Album', 'Genre', 'Year', 'Total Time', 'Track Number', 'Play Count', 'Date Added'];
  const rest = [...headerSet].filter(h => !priority.includes(h)).sort();
  const headers = [...priority.filter(h => headerSet.has(h)), ...rest];

  return { headers, rows };
}

export function parseXML(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return { headers: [], rows: [] };

  // Detect Apple Music / iTunes plist format
  if (doc.documentElement.tagName === 'plist') {
    const result = parsePlistTracks(doc);
    if (result) return result;
  }

  // Generic XML: find repeating record elements
  const root = doc.documentElement;
  let records = [];
  // Try direct children first
  const childTags = {};
  for (const child of root.children) {
    childTags[child.tagName] = (childTags[child.tagName] || 0) + 1;
  }
  const mostCommonTag = Object.entries(childTags).sort((a, b) => b[1] - a[1])[0];
  if (mostCommonTag && mostCommonTag[1] > 1) {
    records = [...root.querySelectorAll(`:scope > ${mostCommonTag[0]}`)];
  } else {
    // Try one level deeper (e.g., <root><items><item>...)
    for (const wrapper of root.children) {
      const innerTags = {};
      for (const child of wrapper.children) {
        innerTags[child.tagName] = (innerTags[child.tagName] || 0) + 1;
      }
      const inner = Object.entries(innerTags).sort((a, b) => b[1] - a[1])[0];
      if (inner && inner[1] > 1) {
        records = [...wrapper.querySelectorAll(`:scope > ${inner[0]}`)];
        break;
      }
    }
  }
  if (!records.length) return { headers: [], rows: [] };

  // Extract headers from first record's child element names + attributes
  const headerSet = new Set();
  records.slice(0, 20).forEach(rec => {
    for (const attr of rec.attributes) headerSet.add(`@${attr.name}`);
    for (const child of rec.children) headerSet.add(child.tagName);
  });
  const headers = [...headerSet];

  const rows = records.map(rec => {
    const row = {};
    for (const h of headers) {
      if (h.startsWith('@')) {
        row[h] = rec.getAttribute(h.slice(1)) || '';
      } else {
        const el = rec.querySelector(`:scope > ${h}`);
        row[h] = el ? el.textContent.trim() : '';
      }
    }
    return row;
  });

  return { headers, rows };
}

// Cheap content-sniff: anything starting with "<?xml" or "<" is
// treated as XML and routed through parseXML. Run on the trimmed
// leading whitespace so files saved with a UTF-8 BOM-stripped
// preamble still match.
export function isXML(text) {
  return text.trimStart().startsWith('<?xml') || text.trimStart().startsWith('<');
}
