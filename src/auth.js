import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const COOKIE_NAME = 'trainer_auth';

/** Optional single-password auth. When password is empty, every request is allowed. */
export function makeAuth({ password = '', secret = randomBytes(32).toString('hex') } = {}) {
  const enabled = !!password;
  const token = createHmac('sha256', secret).update(`trainer:${password}`).digest('hex');
  return {
    enabled,
    cookieFor(candidate) {
      if (!enabled) return null;
      const a = Buffer.from(String(candidate ?? ''));
      const b = Buffer.from(password);
      return a.length === b.length && timingSafeEqual(a, b) ? token : null;
    },
    setCookieHeader(value) {
      return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`;
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
