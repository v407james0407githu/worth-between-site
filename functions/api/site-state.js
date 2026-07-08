import { requireAdminSession } from '../_lib/admin-auth.js';
import { jsonResponse } from '../_lib/http.js';
import { getSupabaseConfig } from '../_lib/supabase.js';

const SITE_ID = 'primary';

const sanitizePayload = (payload) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const teamAccess = source.teamAccess && typeof source.teamAccess === 'object'
    ? {
        ...source.teamAccess,
        members: Array.isArray(source.teamAccess.members)
          ? source.teamAccess.members.map(({ password, ...member }) => member)
          : []
      }
    : undefined;
  return { ...source, teamAccess };
};

const publicPayload = (payload) => {
  const source = sanitizePayload(payload);
  return {
    heroSlides: source.heroSlides,
    contentPages: source.contentPages,
    homepageContent: source.homepageContent,
    brands: source.brands
  };
};

export async function onRequestGet({ request, env }) {
  const config = getSupabaseConfig(env);
  if (!config) return jsonResponse({ ok: false, message: '站台資料服務尚未設定' }, 503);

  const response = await fetch(
    `${config.baseUrl}/rest/v1/site_state?site_id=eq.${SITE_ID}&select=payload,updated_at&limit=1`,
    { headers: config.headers }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Failed to read site_state:', detail || `HTTP ${response.status}`);
    return jsonResponse({
      ok: false,
      message: `無法讀取站台資料${detail ? `：${detail}` : ''}`,
      supabaseHost: config.host || null,
      supabaseKeyProjectRef: config.keyProjectRef || null
    }, 502);
  }

  const rows = await response.json();
  const row = rows?.[0] || null;
  const session = await requireAdminSession(request, env);
  return jsonResponse({
    ok: true,
    payload: session ? sanitizePayload(row?.payload) : publicPayload(row?.payload),
    updated_at: row?.updated_at || null
  });
}

export async function onRequestPut({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);

  const config = getSupabaseConfig(env);
  if (!config) return jsonResponse({ ok: false, message: '站台資料服務尚未設定' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: '站台資料格式錯誤' }, 400);
  }
  if (!body?.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return jsonResponse({ ok: false, message: '缺少有效的站台資料' }, 400);
  }

  const currentResponse = await fetch(
    `${config.baseUrl}/rest/v1/site_state?site_id=eq.${SITE_ID}&select=payload&limit=1`,
    { headers: config.headers }
  );
  const currentRows = currentResponse.ok ? await currentResponse.json() : [];
  const currentPayload = currentRows?.[0]?.payload && typeof currentRows[0].payload === 'object'
    ? currentRows[0].payload
    : {};
  const payload = sanitizePayload({ ...currentPayload, ...body.payload });
  const updatedAt = new Date().toISOString();
  const response = await fetch(`${config.baseUrl}/rest/v1/site_state?on_conflict=site_id`, {
    method: 'POST',
    headers: {
      ...config.headers,
      prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ site_id: SITE_ID, payload, updated_at: updatedAt })
  });
  if (!response.ok) return jsonResponse({ ok: false, message: '無法儲存站台資料' }, 502);

  return jsonResponse({ ok: true, updated_at: updatedAt });
}
