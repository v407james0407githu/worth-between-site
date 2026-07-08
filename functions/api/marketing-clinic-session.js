import { cleanText, digest, enforceIdentifierRateLimit, getSourceHash, isValidEmail, isValidPhone, normalizePhone, supabaseRequest, verifyTurnstile } from '../_lib/chat.js';
import { jsonResponse } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = cleanText(url.searchParams.get('sessionId'), 80);
  const visitorId = cleanText(url.searchParams.get('visitorId'), 80);
  if (!sessionId || !visitorId) return jsonResponse({ ok: false, message: '缺少診斷工作階段' }, 400);

  const sessionResponse = await supabaseRequest(
    env,
    `chat_sessions?id=eq.${encodeURIComponent(sessionId)}&visitor_id=eq.${encodeURIComponent(visitorId)}&select=id,visitor_id,visitor_name,visitor_email,visitor_phone,company_name,status,topic,summary,lead_category,lead_score,recommended_service,consultation_requested_at,user_message_count,blocked_message_count,last_active_at,created_at&limit=1`
  );
  const sessions = sessionResponse.ok ? await sessionResponse.json() : [];
  if (!sessions?.[0]) return jsonResponse({ ok: false, message: '找不到診斷紀錄' }, 404);

  const messagesResponse = await supabaseRequest(
    env,
    `chat_messages?session_id=eq.${encodeURIComponent(sessionId)}&select=id,role,content,created_at&order=created_at.asc`
  );
  const messages = messagesResponse.ok ? await messagesResponse.json() : [];
  return jsonResponse({ ok: true, session: sessions[0], messages });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: '資料格式錯誤' }, 400);
  }
  if (!body?.consent) return jsonResponse({ ok: false, message: '請先同意 AI 與資料保存告知' }, 400);
  if (!(await verifyTurnstile(request, env, body.turnstileToken))) {
    return jsonResponse({ ok: false, message: '人機驗證失敗，請重新驗證後再試' }, 403);
  }
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 160).toLowerCase();
  const phone = normalizePhone(body.phone);
  const missing = [];
  if (!name) missing.push('姓名');
  if (!email) missing.push('Email');
  if (!phone) missing.push('電話');
  if (missing.length) return jsonResponse({ ok: false, message: `請填寫${missing.join('、')}` }, 400);
  if (!isValidEmail(email)) return jsonResponse({ ok: false, message: '請填寫有效的 Email' }, 400);
  if (!isValidPhone(phone)) return jsonResponse({ ok: false, message: '請填寫有效的電話號碼' }, 400);

  const phoneHash = await digest(`phone:${phone}:${env.ADMIN_SESSION_SECRET || 'worth-between'}`);
  const allowed = await enforceIdentifierRateLimit(phoneHash, env, {
    namespace: 'phone-session-day',
    limit: Number(env.MARKETING_CLINIC_DAILY_SESSION_LIMIT) || 2
  });
  if (!allowed) return jsonResponse({ ok: false, message: '此電話今日已使用兩次診斷，請明天再試' }, 429);

  const session = {
    id: crypto.randomUUID(),
    visitor_id: cleanText(body.visitorId, 80) || crypto.randomUUID(),
    source_hash: await getSourceHash(request, env),
    phone_hash: phoneHash,
    visitor_name: name,
    visitor_email: email,
    visitor_phone: phone,
    company_name: cleanText(body.company, 120) || null,
    status: 'active',
    consented_at: new Date().toISOString(),
    last_active_at: new Date().toISOString()
  };
  const response = await supabaseRequest(env, 'chat_sessions', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(session)
  });
  if (!response.ok) return jsonResponse({ ok: false, message: '無法建立診斷工作階段' }, 502);
  return jsonResponse({ ok: true, session: (await response.json())?.[0] || session });
}
