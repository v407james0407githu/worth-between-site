import { jsonResponse } from '../_lib/http.js';

export async function onRequestGet({ env }) {
  return jsonResponse({
    ok: true,
    turnstileEnabled: Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY),
    turnstileSiteKey: env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : ''
  });
}
