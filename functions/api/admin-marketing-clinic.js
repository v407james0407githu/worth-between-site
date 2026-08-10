import { requireAdminSession } from '../_lib/admin-auth.js';
import { cleanText, supabaseRequest, writeAuditLog } from '../_lib/chat.js';
import { jsonResponse } from '../_lib/http.js';

const PROFILE_TOPIC = 'ChatGPT 初診基本資料';

export async function onRequestGet({ request, env }) {
  const admin = await requireAdminSession(request, env);
  if (!admin) return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);
  const url = new URL(request.url);
  const sessionId = cleanText(url.searchParams.get('sessionId'), 80);
  if (sessionId) {
    const sessionResponse = await supabaseRequest(env, `chat_sessions?id=eq.${encodeURIComponent(sessionId)}&topic=eq.${encodeURIComponent(PROFILE_TOPIC)}&select=*&limit=1`);
    return jsonResponse({
      ok: true,
      session: (sessionResponse.ok ? await sessionResponse.json() : [])?.[0] || null,
      messages: []
    });
  }
  const response = await supabaseRequest(env, `chat_sessions?topic=eq.${encodeURIComponent(PROFILE_TOPIC)}&select=*&order=created_at.desc&limit=500`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const detail = cleanText(error.message || error.details || error.hint, 300);
    return jsonResponse({ ok: false, message: detail ? `無法讀取診斷紀錄：${detail}` : '無法讀取診斷紀錄' }, 502);
  }
  const sessions = await response.json();
  const metrics = sessions.reduce((result, session) => {
    result.total += 1;
    return result;
  }, { total: 0 });
  return jsonResponse({ ok: true, sessions, metrics });
}

const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export async function onRequestPost({ request, env }) {
  const admin = await requireAdminSession(request, env);
  if (!admin) return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);
  const sessionsResponse = await supabaseRequest(env, `chat_sessions?topic=eq.${encodeURIComponent(PROFILE_TOPIC)}&select=*&order=created_at.desc&limit=5000`);
  const sessions = sessionsResponse.ok ? await sessionsResponse.json() : [];
  const headers = ['session_id', 'created_at', 'name', 'email', 'phone', 'company'];
  const rows = sessions.map((session) => [
    session.id, session.created_at, session.visitor_name, session.visitor_email, session.visitor_phone, session.company_name,
  ]);
  await writeAuditLog(env, admin.sub, 'export_csv', 'chat_sessions', null, { count: sessions.length });
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')}`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="marketing-clinic-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store'
    }
  });
}
