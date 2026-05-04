// ─── Artifact Archive — hearted-track store ───
//
// The user's collection of "hearted" tracks, persisted to
// localStorage. The collection is opaque outside this module: the
// internal array is never exposed for direct mutation. Consumers
// either read via getAll() / getCount() / isHearted(), mutate via
// addArtifact() / removeByKey() / removeAt(), or react to changes
// via subscribe(listener).
//
// On every mutation the collection is rewritten to localStorage and
// every listener is invoked. This is the only module that talks to
// localStorage; SECURITY.md and the README's Data & Privacy section
// reflect that contract.

const STORAGE_KEY = 'artifactArchive';

// Cap on persisted entries — defensive against a corrupted or
// malicious localStorage payload growing unbounded.
const MAX_ENTRIES = 10000;

let artifacts = loadFromStorage();
const listeners = new Set();

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const capped = parsed.slice(0, MAX_ENTRIES);
    const validShape = (a) => a && typeof a === 'object' && typeof a.key === 'string';
    return capped.filter(validShape);
  } catch {
    return [];
  }
}

function persist() {
  const serialized = JSON.stringify(artifacts);
  localStorage.setItem(STORAGE_KEY, serialized);
  for (const listener of listeners) listener();
}

// ─── Public API ───

// Stable identity for an entry, used for equality + lookup. Combines
// (name, artist, album) with a triple-pipe separator that's vanishingly
// unlikely to occur inside any real metadata field.
export function getArtifactKey(entry) {
  const row = entry.row;
  const name = row[entry.nameCol] || '';
  const artist = (entry.artistCol && row[entry.artistCol]) || '';
  const album = (entry.albumCol && row[entry.albumCol]) || '';
  return name + '|||' + artist + '|||' + album;
}

export function isHearted(entry) {
  const key = getArtifactKey(entry);
  return artifacts.some(a => a.key === key);
}

export function getAll() {
  return artifacts;
}

export function getCount() {
  return artifacts.length;
}

export function addArtifact(artifact) {
  artifacts.push(artifact);
  persist();
}

export function removeByKey(key) {
  artifacts = artifacts.filter(a => a.key !== key);
  persist();
}

export function removeAt(idx) {
  artifacts.splice(idx, 1);
  persist();
}

// Register a callback to fire on every mutation. Returns an
// unsubscribe function so listeners can detach cleanly during teardown.
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
