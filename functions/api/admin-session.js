import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  getAdminSession,
  isAdminAuthConfigured,
  verifyAdminCredentials
} from '../_lib/admin-auth.js';
import { jsonResponse } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const session = await getAdminSession(request, env);
  return jsonResponse({
    authenticated: Boolean(session),
    configured: isAdminAuthConfigured(env),
    email: session?.sub || null
  });
}

export async function onRequestPost({ request, env }) {
  if (!isAdminAuthConfigured(env)) {
    return jsonResponse({ ok: false, message: '管理者登入尚未完成環境設定' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: '登入資料格式錯誤' }, 400);
  }

  const isValid = await verifyAdminCredentials(env, body.email, body.password);
  if (!isValid) {
    return jsonResponse({ ok: false, message: '帳號或密碼錯誤' }, 401);
  }

  return jsonResponse(
    { ok: true, email: String(env.ADMIN_EMAIL).trim().toLowerCase() },
    200,
    { 'set-cookie': await createAdminSessionCookie(env) }
  );
}

export async function onRequestDelete() {
  return jsonResponse({ ok: true }, 200, { 'set-cookie': clearAdminSessionCookie() });
}
