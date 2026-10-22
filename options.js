const api = globalThis.browser;
const DEFAULT_SETTINGS = { promptText: 'gf↝', searchEngine: 'bing', customSearchUrl: '' };
const form = document.getElementById('settings-form');
const promptText = document.getElementById('prompt-text');
const searchEngine = document.getElementById('search-engine');
const customEngine = document.getElementById('custom-engine');
const customSearchUrl = document.getElementById('custom-search-url');
const status = document.getElementById('status');

function updateCustomVisibility() {
  customEngine.hidden = searchEngine.value !== 'custom';
  customSearchUrl.required = searchEngine.value === 'custom';
}

async function loadSettings() {
  const settings = await api.storage.local.get(DEFAULT_SETTINGS);
  promptText.value = settings.promptText;
  searchEngine.value = settings.searchEngine;
  customSearchUrl.value = settings.customSearchUrl;
  updateCustomVisibility();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  if (searchEngine.value === 'custom') {
    try {
      if (!customSearchUrl.value.includes('%s')) throw new Error('missing placeholder');
      new URL(customSearchUrl.value.trim().replace('%s', 'test'));
    } catch (error) {
      customSearchUrl.setCustomValidity('Enter a valid URL containing %s.');
      customSearchUrl.reportValidity();
      return;
    }
  }
  customSearchUrl.setCustomValidity('');
  await api.storage.local.set({
    promptText: promptText.value.trim() || DEFAULT_SETTINGS.promptText,
    searchEngine: searchEngine.value,
    customSearchUrl: customSearchUrl.value.trim()
  });
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 1800);
});

document.getElementById('reset').addEventListener('click', async () => {
  await api.storage.local.set(DEFAULT_SETTINGS);
  await loadSettings();
  status.textContent = 'Reset.';
  setTimeout(() => { status.textContent = ''; }, 1800);
});

searchEngine.addEventListener('change', updateCustomVisibility);
loadSettings();
