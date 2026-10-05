// Push notifications to the phone without APNs: through the Home Assistant Companion app or an ntfy topic.
// url is a deep link (restbell://chat) that opens the iOS app when the notification is tapped.

/**
 * makeNotifier({ haUrl, haToken, haService, ntfyUrl, ntfyToken, publicUrl })
 * haService: the notify service for the phone, e.g. 'mobile_app_iphone' (with or without the 'notify.' prefix).
 */
export function makeNotifier({ haUrl, haToken, haService, ntfyUrl, ntfyToken, fetchImpl = fetch, log = console } = {}) {
  const ha = !!(haUrl && haToken && haService);
  const ntfy = !!ntfyUrl;
  const service = haService?.replace(/^notify\./, '');

  async function viaHa({ title, body, url, group }) {
    const res = await fetchImpl(`${haUrl.replace(/\/$/, '')}/api/services/notify/${service}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' },
      // The Companion app opens data.url on tap; group stacks related notifications.
      body: JSON.stringify({ title, message: body, data: { url, group: group ?? 'restbell', push: { 'thread-id': group ?? 'restbell' } } }),
    });
    if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
  }

  async function viaNtfy({ title, body, url, tags }) {
    const headers = { Title: encodeHeader(title) };
    if (url) headers.Click = url;
    if (tags) headers.Tags = tags;
    if (ntfyToken) headers.Authorization = `Bearer ${ntfyToken}`;
    const res = await fetchImpl(ntfyUrl, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
  }

  return {
    configured: ha || ntfy,
    channels: [ha && 'homeassistant', ntfy && 'ntfy'].filter(Boolean),
    /** Send to every configured channel. Never throws: a failed push must not fail the request that caused it. */
    async send(n) {
      const jobs = [];
      if (ha) jobs.push(viaHa(n));
      if (ntfy) jobs.push(viaNtfy(n));
      const results = await Promise.allSettled(jobs);
      for (const r of results) if (r.status === 'rejected') log.error?.(`[notify] ${r.reason?.message ?? r.reason}`);
      return results.some((r) => r.status === 'fulfilled');
    },
  };
}

// HTTP headers are latin-1; ntfy accepts RFC 2047 encoded words for anything else.
function encodeHeader(s) {
  const text = String(s ?? '');
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

/** First line of a coach message, short enough for a notification body. */
export function preview(text, max = 180) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
