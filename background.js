chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_YTCFG') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => ({
        apiKey: window.ytcfg?.get('INNERTUBE_API_KEY') ?? null,
        context: window.ytcfg?.get('INNERTUBE_CONTEXT') ?? null,
        clientName: window.ytcfg?.get('INNERTUBE_CLIENT_NAME') ?? null,
        clientVersion: window.ytcfg?.get('INNERTUBE_CLIENT_VERSION') ?? null,
        authUser: window.ytcfg?.get('SESSION_INDEX') ?? '0',
      }),
    })
      .then(([result]) => sendResponse({ data: result.result }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === 'GET_SAPISID') {
    chrome.cookies.get(
      { url: 'https://www.youtube.com', name: 'SAPISID' },
      (cookie) => sendResponse({ sapisid: cookie ? cookie.value : null })
    );
    return true;
  }
});
