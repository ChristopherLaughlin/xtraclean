// Popup: focus an existing x.com tab if present, otherwise open one.
const openBtn = document.getElementById('open');
const warn = document.getElementById('warn');

chrome.tabs.query({}, (tabs) => {
  const xTab = tabs.find((t) => /https:\/\/(x|twitter)\.com\//.test(t.url || ''));
  if (xTab) {
    openBtn.textContent = 'Go to your X tab →';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.update(xTab.id, { active: true });
      if (xTab.windowId != null) chrome.windows.update(xTab.windowId, { focused: true });
      window.close();
    });
  } else {
    warn.style.display = 'block';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://x.com/home' });
      window.close();
    });
  }
});
