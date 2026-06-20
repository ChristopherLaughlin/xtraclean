// Popup: one button that actually opens the on-page panel.
// If we're on X, message the content script to open. If the script isn't there
// yet (page predates this version), reload the tab with an "open on load" flag.
// If we're not on X, focus an existing X tab or open a new one.
const btn = document.getElementById('open');
const how = document.getElementById('how');

function openOnTab(tab) {
  chrome.tabs.sendMessage(tab.id, { type: 'XC_OPEN_PANEL' }, () => {
    if (chrome.runtime.lastError) {
      // content script not injected yet → reload so it loads, then auto-open
      chrome.storage.local.set({ xc_open_on_load: true }, () => {
        chrome.tabs.reload(tab.id);
        window.close();
      });
    } else {
      window.close();
    }
  });
}

const isX = (u) => /^https:\/\/(x|twitter)\.com\//.test(u || '');

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const active = tabs[0];
  if (active && isX(active.url)) {
    btn.textContent = 'Open XtraClean';
    btn.onclick = () => openOnTab(active);
    return;
  }
  // not currently on X — look for an existing X tab
  chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }, (xs) => {
    if (xs && xs.length) {
      btn.textContent = 'Open XtraClean on X';
      btn.onclick = () => { chrome.tabs.update(xs[0].id, { active: true }); openOnTab(xs[0]); };
    } else {
      btn.textContent = 'Open X to get started';
      how.innerHTML = 'You need to be on <b>x.com</b>. This opens it for you, then the panel appears automatically.';
      btn.onclick = () => {
        chrome.storage.local.set({ xc_open_on_load: true }, () => {
          chrome.tabs.create({ url: 'https://x.com/home' });
          window.close();
        });
      };
    }
  });
});
