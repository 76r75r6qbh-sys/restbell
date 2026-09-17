import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const COOKIE_NAME = 'trainer_auth';

/**
 * Optional single-password auth. When password is empty, every request is allowed.
 * Wrong passwords are counted per client; after maxFailures within windowMs that client is locked out until the window passes.
 */
export function makeAuth({ password = '', secret = randomBytes(32).toString('hex'), maxFailures = 10, windowMs = 15 * 60_000, now = Date.now } = {}) {
  const enabled = !!password;
  const token = createHmac('sha256', secret).update(`trainer:${password}`).digest('hex');
  const failures = new Map(); // client -> { count, since }
  return {
    enabled,
    cookieFor(candidate) {
      if (!enabled) return null;
      const a = Buffer.from(String(candidate ?? ''));
      const b = Buffer.from(password);
      return a.length === b.length && timingSafeEqual(a, b) ? token : null;
    },
    login(candidate, client) {
      const t = now();
      for (const [key, f] of failures) if (t - f.since >= windowMs) failures.delete(key);
      const f = failures.get(client);
      if (f && f.count >= maxFailures) return { ok: false, locked: true, retryAfterSec: Math.ceil((f.since + windowMs - t) / 1000) };
      const cookie = this.cookieFor(candidate);
      if (cookie) {
        failures.delete(client);
        return { ok: true, cookie };
      }
      failures.set(client, { count: (f?.count ?? 0) + 1, since: f?.since ?? t });
      return { ok: false, locked: false };
    },
    setCookieHeader(value, { secure = false } = {}) {
      return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${secure ? '; Secure' : ''}`;
    },
    verify(cookieHeader) {
      if (!enabled) return true;
      const m = /(?:^|;\s*)trainer_auth=([a-f0-9]+)/.exec(cookieHeader ?? '');
      if (!m) return false;
      const a = Buffer.from(m[1]);
      const b = Buffer.from(token);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
