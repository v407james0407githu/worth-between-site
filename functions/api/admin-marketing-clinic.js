import { requireAdminSession } from '../_lib/admin-auth.js';
import { cleanText, supabaseRequest, writeAuditLog } from '../_lib/chat.js';
import { jsonResponse } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const admin = await requireAdminSession(request, env);
  if (!admin) return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);
  const url = new URL(request.url);
  const sessionId = cleanText(url.searchParams.get('sessionId'), 80);
  if (sessionId) {
    const [sessionResponse, messageResponse] = await Promise.all([
      supabaseRequest(env, `chat_sessions?id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`),
      supabaseRequest(env, `chat_messages?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.asc`)
    ]);
    return jsonResponse({
      ok: true,
      session: (sessionResponse.ok ? await sessionResponse.json() : [])?.[0] || null,
      messages: messageResponse.ok ? await messageResponse.json() : []
    });
  }
  const response = await supabaseRequest(
    env,
    'chat_sessions?select=id,visitor_name,visitor_email,visitor_phone,company_name,status,topic,summary,lead_category,lead_score,recommended_service,consultation_requested_at,user_message_count,blocked_message_count,input_tokens,output_tokens,estimated_cost_usd,last_active_at,created_at,completed_at&order=last_active_at.desc&limit=500'
  );
  if (!response.ok) return jsonResponse({ ok: false, message: '無法讀取診斷紀錄' }, 502);
  const sessions = await response.json();
  const metrics = sessions.reduce((result, session) => {
    result.total += 1;
    result.completed += session.status === 'completed' ? 1 : 0;
    result.consultations += session.consultation_requested_at ? 1 : 0;
    result.hotLeads += session.lead_category === 'hot' ? 1 : 0;
    result.blockedMessages += Number(session.blocked_message_count) || 0;
    result.blockedSessions += session.status === 'blocked' ? 1 : 0;
    result.inputTokens += Number(session.input_tokens) || 0;
    result.outputTokens += Number(session.output_tokens) || 0;
    result.estimatedCostUsd += Number(session.estimated_cost_usd) || 0;
    return result;
  }, { total: 0, completed: 0, consultations: 0, hotLeads: 0, blockedMessages: 0, blockedSessions: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
  metrics.completionRate = metrics.total ? Math.round(metrics.completed / metrics.total * 1000) / 10 : 0;
  metrics.consultationRate = metrics.total ? Math.round(metrics.consultations / metrics.total * 1000) / 10 : 0;
  return jsonResponse({ ok: true, sessions, metrics });
}

const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export async function onRequestPost({ request, env }) {
  const admin = await requireAdminSession(request, env);
  if (!admin) return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);
  const sessionsResponse = await supabaseRequest(env, 'chat_sessions?select=*&order=created_at.desc&limit=5000');
  const sessions = sessionsResponse.ok ? await sessionsResponse.json() : [];
  const messagesResponse = await supabaseRequest(env, 'chat_messages?select=session_id,role,content,moderation_status,moderation_reason,usage_type,model_name,input_tokens,output_tokens,estimated_cost_usd,created_at&order=created_at.asc&limit=20000');
  const messages = messagesResponse.ok ? await messagesResponse.json() : [];
  const grouped = new Map();
  messages.forEach((message) => {
    grouped.set(message.session_id, [...(grouped.get(message.session_id) || []), `${message.role} [${message.usage_type}; ${message.model_name || 'no-model'}; input=${message.input_tokens || 0}; output=${message.output_tokens || 0}; cost_usd=${message.estimated_cost_usd || 0}; ${message.moderation_status}${message.moderation_reason ? `: ${message.moderation_reason}` : ''}]: ${message.content}`]);
  });
  const headers = ['session_id', 'created_at', 'name', 'email', 'phone', 'company', 'status', 'topic', 'lead_category', 'lead_score', 'recommended_service', 'consultation_requested_at', 'estimated_cost_usd', 'message_count', 'blocked_message_count', 'summary', 'conversation'];
  const rows = sessions.map((session) => [
    session.id, session.created_at, session.visitor_name, session.visitor_email, session.visitor_phone, session.company_name,
    session.status, session.topic, session.lead_category, session.lead_score, session.recommended_service,
    session.consultation_requested_at, session.estimated_cost_usd, session.user_message_count, session.blocked_message_count, session.summary,
    (grouped.get(session.id) || []).join('\n\n')
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
