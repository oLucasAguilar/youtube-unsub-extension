(() => {
  'use strict';

  const processed = new WeakSet();

  function getSAPISID() {
    const match = document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/);
    return match ? match[1] : null;
  }

  async function buildAuthHeader() {
    const sapisid = getSAPISID();
    if (!sapisid) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_SAPISID' }, (resp) => {
          if (resp?.sapisid) resolve(computeHash(resp.sapisid));
          else reject(new Error('SAPISID unavailable'));
        });
      });
    }
    return computeHash(sapisid);
  }

  async function computeHash(sapisid) {
    const ts = Math.floor(Date.now() / 1000);
    const encoded = new TextEncoder().encode(`${ts} ${sapisid} https://www.youtube.com`);
    const hashBuffer = await crypto.subtle.digest('SHA-1', encoded);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `SAPISIDHASH ${ts}_${hashHex}`;
  }

  function getYtcfg() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_YTCFG' }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp?.data?.apiKey && resp?.data?.context) return resolve(resp.data);
        reject(new Error('ytcfg unavailable'));
      });
    });
  }

  async function unsubscribeFromChannel(channelId) {
    const { apiKey, context, clientName, clientVersion, authUser } = await getYtcfg();
    const authHeader = await buildAuthHeader();

    const resp = await fetch(
      `https://www.youtube.com/youtubei/v1/subscription/unsubscribe?key=${apiKey}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
          'X-Origin': 'https://www.youtube.com',
          'X-Goog-AuthUser': String(authUser ?? '0'),
          ...(clientName && { 'X-YouTube-Client-Name': clientName }),
          ...(clientVersion && { 'X-YouTube-Client-Version': clientVersion }),
        },
        body: JSON.stringify({ context, channelIds: [channelId] }),
      }
    );

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  }

  async function fetchChannelIdFromPage(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`page fetch HTTP ${resp.status}`);
    const html = await resp.text();
    const match = html.match(/"externalId":"([\w-]+)"/);
    if (match) return match[1];
    throw new Error(`channel ID not found on page: ${url}`);
  }

  function findBrowseId(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    if (typeof obj.browseId === 'string' && obj.browseId.length > 4) return obj.browseId;
    for (const val of Object.values(obj)) {
      const found = findBrowseId(val, depth + 1);
      if (found) return found;
    }
    return null;
  }

  async function resolveHandleToChannelId(handle) {
    const { apiKey, context } = await getYtcfg();

    const resp = await fetch(
      `https://www.youtube.com/youtubei/v1/navigation/resolve_url?key=${apiKey}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, url: `https://www.youtube.com${handle}` }),
      }
    );

    if (!resp.ok) throw new Error(`resolve_url HTTP ${resp.status}`);
    const data = await resp.json();

    const browseId = findBrowseId(data);
    if (browseId) return browseId;

    // Legacy custom URLs return urlEndpoint instead of browseEndpoint.
    // Fall back to fetching the page and parsing the channel ID from HTML.
    const fallbackUrl = data?.endpoint?.urlEndpoint?.url;
    if (fallbackUrl) return fetchChannelIdFromPage(fallbackUrl);

    throw new Error('browseId not found');
  }

  function getChannelIdFromPolymerData(card) {
    const media = card.querySelector('ytd-rich-grid-media') || card;
    for (const el of [media, card]) {
      const data = el.data;
      if (!data) continue;
      for (const key of ['shortBylineText', 'ownerText', 'longBylineText']) {
        const ep = data?.[key]?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
        if (ep?.browseId) return { type: 'id', value: ep.browseId };
        if (ep?.canonicalBaseUrl) return { type: 'url', value: ep.canonicalBaseUrl };
      }
    }
    return null;
  }

  function extractChannelHrefFromDOM(card) {
    for (const a of card.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      if (/^\/channel\/UC[\w-]+/.test(href)) return href;
      if (/^\/@[\w.-]+/.test(href)) return href;
      if (/^\/c\/[\w.-]+/.test(href)) return href;
    }
    return null;
  }

  async function getChannelId(card) {
    const poly = getChannelIdFromPolymerData(card);
    if (poly) {
      return poly.type === 'id' ? poly.value : resolveHandleToChannelId(poly.value);
    }

    const href = extractChannelHrefFromDOM(card);
    if (href) {
      const m = href.match(/^\/channel\/(UC[\w-]+)/);
      if (m) return m[1];
      if (/^\/@[\w.-]+/.test(href) || /^\/c\/[\w.-]+/.test(href)) {
        return resolveHandleToChannelId(href);
      }
    }

    throw new Error('No channel found in card');
  }

  function injectUnsubscribeButton(card) {
    if (processed.has(card)) return;
    processed.add(card);

    const thumbnail = card.querySelector('#thumbnail') || card.querySelector('ytd-thumbnail') || card;
    const btn = document.createElement('button');
    btn.className = 'yt-unsub-btn';
    btn.textContent = 'Unsubscribe';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.textContent = '...';
      btn.disabled = true;

      try {
        const channelId = await getChannelId(card);
        await unsubscribeFromChannel(channelId);
        btn.textContent = 'Done';
        card.classList.add('yt-unsub-done');
      } catch (err) {
        console.error('[yt-unsub]', err);
        btn.textContent = 'Failed';
        btn.disabled = false;
      }
    });

    thumbnail.style.position = 'relative';
    thumbnail.appendChild(btn);
  }

  function processCards() {
    document.querySelectorAll('ytd-rich-item-renderer').forEach(injectUnsubscribeButton);
  }

  new MutationObserver(processCards).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', processCards);
  processCards();
})();
