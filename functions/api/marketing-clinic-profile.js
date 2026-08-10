import { cleanText, digest, getSourceHash, isValidEmail, isValidPhone, normalizePhone, supabaseRequest } from '../_lib/chat.js';
import { jsonResponse } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: '資料格式錯誤' }, 400);
  }

  const name = cleanText(body?.name, 80);
  const email = cleanText(body?.email, 160).toLowerCase();
  const phone = normalizePhone(body?.phone);
  const company = cleanText(body?.company, 120);
  const missing = [];
  if (!name) missing.push('姓名');
  if (!phone) missing.push('電話');
  if (!email) missing.push('Email');
  if (!company) missing.push('公司名稱');
  if (missing.length) return jsonResponse({ ok: false, message: `請填寫${missing.join('、')}` }, 400);
  if (!isValidEmail(email)) return jsonResponse({ ok: false, message: '請填寫有效的 Email' }, 400);
  if (!isValidPhone(phone)) return jsonResponse({ ok: false, message: '請填寫有效的電話號碼' }, 400);

  const now = new Date().toISOString();
  const profile = {
    id: crypto.randomUUID(),
    visitor_id: crypto.randomUUID(),
    source_hash: await getSourceHash(request, env),
    phone_hash: await digest(`phone:${phone}:${env.ADMIN_SESSION_SECRET || 'worth-between'}`),
    visitor_name: name,
    visitor_email: email,
    visitor_phone: phone,
    company_name: company,
    status: 'active',
    topic: 'ChatGPT 初診基本資料',
    user_message_count: 0,
    blocked_message_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
    consented_at: now,
    last_active_at: now
  };
  const response = await supabaseRequest(env, 'chat_sessions', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(profile)
  });
  if (!response.ok) return jsonResponse({ ok: false, message: '無法儲存基本資料，請稍後再試' }, 502);
  return jsonResponse({ ok: true, profile: (await response.json())?.[0] || profile });
}
