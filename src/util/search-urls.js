// ─── External-service search-link builders ───
//
// Each builder takes (song, artist) and returns a search URL on the
// target service. These are *deep search links* (e.g. open the
// service's search results page pre-filled with the query), not API
// calls — no auth required, no CORS to worry about.
//
// safeHref() defends the album card's <a href> attributes against
// any URL whose protocol isn't http(s) — e.g. javascript: or data:
// in case a future code path passes user-controlled input through.

function buildSearchQuery(song, artist) {
  const parts = [artist, song];
  const nonEmptyParts = parts.filter(Boolean);
  return nonEmptyParts.join(' ');
}

export function buildYouTubeSearchUrl(song, artist) {
  const query = buildSearchQuery(song, artist);
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
}

export function buildSpotifySearchUrl(song, artist) {
  const query = buildSearchQuery(song, artist);
  return 'https://open.spotify.com/search/' + encodeURIComponent(query);
}

export function buildAppleMusicSearchUrl(song, artist) {
  const query = buildSearchQuery(song, artist);
  return 'https://music.apple.com/us/search?term=' + encodeURIComponent(query);
}

export function buildDiscogsSearchUrl(song, artist) {
  const query = buildSearchQuery(song, artist);
  return 'https://www.discogs.com/search/?q=' + encodeURIComponent(query) + '&type=all';
}

export function safeHref(url) {
  try {
    const parsed = new URL(url);
    const isWebProtocol = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    if (!isWebProtocol) return '#';
    return url;
  } catch {
    return '#';
  }
}
