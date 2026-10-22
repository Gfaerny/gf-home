const api = globalThis.browser;
const input = document.getElementById('q');
const prompt = document.getElementById('prompt');
const suggestionsBox = document.getElementById('suggestions');

const DEFAULT_SETTINGS = { promptText: 'gf↝', searchEngine: 'bing', customSearchUrl: '' };
const SEARCH_ENGINES = {
  bing: { name: 'Bing', searchUrl: 'https://www.bing.com/search?q=%s', suggestUrl: 'https://www.bing.com/osjson.aspx?query=%s' },
  google: { name: 'Google', searchUrl: 'https://www.google.com/search?q=%s', suggestUrl: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q=%s', suggestUrl: 'https://duckduckgo.com/ac/?q=%s' },
  brave: { name: 'Brave Search', searchUrl: 'https://search.brave.com/search?q=%s', suggestUrl: 'https://search.brave.com/api/suggest?q=%s' }
};

let settings = { ...DEFAULT_SETTINGS };
let selectedIndex = -1;
let currentSuggestions = [];
let requestId = 0;
let suggestionAbortController;

async function loadSettings() {
  const saved = await api.storage.local.get(DEFAULT_SETTINGS);
  settings = { ...DEFAULT_SETTINGS, ...saved };
  prompt.textContent = `${settings.promptText} `;
  positionSuggestions();
}

function focusInput() {
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function positionSuggestions() {
  suggestionsBox.style.left = `${prompt.offsetWidth + 10}px`;
}

function isUrl(value) {
  if (/^https?:\/\//i.test(value)) return true;
  if (/\s/.test(value)) return false;
  if (/^(localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i.test(value)) return true;
  return /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(value);
}

function getSearchEngine() {
  return SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.bing;
}

function buildSearchUrl(query) {
  const template = settings.searchEngine === 'custom' ? settings.customSearchUrl : getSearchEngine().searchUrl;
  return (template || SEARCH_ENGINES.bing.searchUrl).replace('%s', encodeURIComponent(query));
}

function isCurrentSearchUrl(url, query) {
  try {
    const target = new URL(buildSearchUrl(query));
    const candidate = new URL(url);
    return candidate.href === target.href || (candidate.origin === target.origin && candidate.pathname === target.pathname &&
      (candidate.searchParams.get('q') || '') === query);
  } catch (error) {
    return false;
  }
}

function executeSearch(value) {
  const query = value.trim();
  if (!query) return;
  location.href = isUrl(query)
    ? (/^https?:\/\//i.test(query) ? query : `https://${query}`)
    : buildSearchUrl(query);
}

function makeUrlSuggestion(item, type) {
  const title = (item.title || '').trim();
  return { type, value: item.url, label: title || item.url, detail: title ? item.url : '' };
}

async function fetchHistorySuggestions(query) {
  try {
    const results = await api.history.search({ text: query, maxResults: 30, startTime: 0 });
    return results.filter(item => item.url && !isCurrentSearchUrl(item.url, query)).map(item => makeUrlSuggestion(item, 'history'));
  } catch (error) {
    return [];
  }
}

async function fetchBookmarkSuggestions(query) {
  try {
    const results = await api.bookmarks.search(query);
    return results.filter(item => item.url).map(item => makeUrlSuggestion(item, 'bookmark'));
  } catch (error) {
    return [];
  }
}

function parseRemoteSuggestions(data) {
  if (Array.isArray(data) && Array.isArray(data[1])) return data[1].map(item => typeof item === 'string' ? item : item.phrase).filter(Boolean);
  if (Array.isArray(data)) return data.map(item => typeof item === 'string' ? item : item.phrase).filter(Boolean);
  return [];
}

async function fetchRemoteSuggestions(query, signal) {
  if (query.length < 2 || settings.searchEngine === 'custom') return [];
  try {
    const response = await fetch(getSearchEngine().suggestUrl.replace('%s', encodeURIComponent(query)), { signal });
    if (!response.ok) return [];
    return parseRemoteSuggestions(await response.json()).slice(0, 8);
  } catch (error) {
    return [];
  }
}

function uniqueSuggestions(suggestions) {
  const seen = new Set();
  return suggestions.filter(item => {
    const key = `${item.type}:${item.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function renderSuggestions(suggestions) {
  currentSuggestions = suggestions;
  suggestionsBox.replaceChildren();
  if (!suggestions.length) {
    suggestionsBox.style.display = 'none';
    return;
  }
  suggestions.forEach((suggestion, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-item';
    button.classList.toggle('selected', index === selectedIndex);
    const label = document.createElement('span');
    label.className = 'suggestion-label';
    label.textContent = suggestion.label;
    button.appendChild(label);
    if (suggestion.detail) {
      const detail = document.createElement('span');
      detail.className = 'suggestion-detail';
      detail.textContent = suggestion.detail;
      button.appendChild(detail);
    }
    button.addEventListener('click', () => executeSuggestion(suggestion));
    suggestionsBox.appendChild(button);
  });
  suggestionsBox.style.display = 'block';
}

function executeSuggestion(suggestion) {
  if (!suggestion) return executeSearch(input.value);
  if (suggestion.type === 'search') executeSearch(suggestion.value);
  else location.href = suggestion.value;
}

async function updateSuggestions(query) {
  const currentRequest = ++requestId;
  suggestionAbortController?.abort();
  suggestionAbortController = new AbortController();
  if (!query.trim()) return renderSuggestions([]);
  const cleanQuery = query.trim();
  const searchSuggestion = { type: 'search', value: cleanQuery, label: `Search “${cleanQuery}”`, detail: getSearchEngine().name };
  const [history, bookmarks, remote] = await Promise.all([
    fetchHistorySuggestions(cleanQuery),
    fetchBookmarkSuggestions(cleanQuery),
    fetchRemoteSuggestions(cleanQuery, suggestionAbortController.signal)
  ]);
  if (currentRequest !== requestId) return;
  const remoteSuggestions = remote.map(value => ({ type: 'search', value, label: value, detail: `${getSearchEngine().name} suggestion` }));
  renderSuggestions(uniqueSuggestions([searchSuggestion, ...remoteSuggestions, ...history, ...bookmarks]));
}

function updateSelection() {
  [...suggestionsBox.querySelectorAll('.suggestion-item')].forEach((item, index) => item.classList.toggle('selected', index === selectedIndex));
}

input.addEventListener('input', () => {
  selectedIndex = -1;
  updateSuggestions(input.value);
});

input.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!currentSuggestions.length) return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    selectedIndex = (selectedIndex + direction + currentSuggestions.length) % currentSuggestions.length;
    updateSelection();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    executeSuggestion(currentSuggestions[selectedIndex]);
  } else if (event.key === 'Escape') {
    selectedIndex = -1;
    renderSuggestions([]);
  }
});

document.addEventListener('click', event => {
  if (!event.target.closest('.wrap')) renderSuggestions([]);
});

window.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  focusInput();
});
window.addEventListener('load', focusInput);
window.addEventListener('resize', positionSuggestions);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) focusInput();
});
