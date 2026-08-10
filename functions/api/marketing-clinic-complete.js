import { cleanText, estimateOpenAiCost, getDailyBudgetUsage, parseJsonObject, supabaseRequest } from '../_lib/chat.js';
import { jsonResponse } from '../_lib/http.js';

const SUMMARY_INSTRUCTIONS = `你是行銷顧問的案件整理助理。根據對話輸出純 JSON，不要 markdown：
{"topic":"20字內主題","summary":"300字內診斷摘要","lead_category":"hot|warm|cold","lead_score":0到100整數,"recommended_service":"最適合的服務或下一步"}
評分依據：問題是否明確、是否有行動時程、是否願意投入資源、是否留下聯絡資料。不得虛構對話未提供的資訊。`;

const buildSummary = async (env, messages, hasContact) => {
  const model = env.OPENAI_SUMMARY_MODEL || env.OPENAI_MODEL || 'gpt-5.4-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: SUMMARY_INSTRUCTIONS,
      input: messages.map((message) => `${message.role === 'user' ? '訪客' : 'AI'}：${message.content}`).join('\n\n').slice(-24000),
      max_output_tokens: 600,
      store: false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || '無法產生診斷摘要');
  const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('') || '';
  const summary = parseJsonObject(outputText);
  if (!summary) throw new Error('診斷摘要格式錯誤');
  const baseScore = Math.min(100, Math.max(0, Number(summary.lead_score) || 0));
  return {
    topic: cleanText(summary.topic, 120) || '行銷診斷',
    summary: cleanText(summary.summary, 2000),
    lead_category: ['hot', 'warm', 'cold'].includes(summary.lead_category) ? summary.lead_category : 'cold',
    lead_score: Math.min(100, baseScore + (hasContact ? 10 : 0)),
    recommended_service: cleanText(summary.recommended_service, 300),
    usage: data.usage || {},
    model
  };
};

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) return jsonResponse({ ok: false, message: '行銷診斷室 AI 尚未完成設定' }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: '資料格式錯誤' }, 400);
  }
  const sessionId = cleanText(body.sessionId, 80);
  const visitorId = cleanText(body.visitorId, 80);
  if (!sessionId || !visitorId) return jsonResponse({ ok: false, message: '缺少診斷工作階段' }, 400);

  const sessionResponse = await supabaseRequest(env, `chat_sessions?id=eq.${encodeURIComponent(sessionId)}&visitor_id=eq.${encodeURIComponent(visitorId)}&select=*&limit=1`);
  const session = (sessionResponse.ok ? await sessionResponse.json() : [])?.[0];
  if (!session) return jsonResponse({ ok: false, message: '找不到診斷紀錄' }, 404);
  if (session.status === 'blocked') return jsonResponse({ ok: false, message: '此診斷已因多次違反使用範圍而停止' }, 403);
  const messageResponse = await supabaseRequest(env, `chat_messages?session_id=eq.${encodeURIComponent(sessionId)}&select=role,content&order=created_at.asc&limit=100`);
  const messages = messageResponse.ok ? await messageResponse.json() : [];
  if (!messages.length) return jsonResponse({ ok: false, message: '尚無足夠對話可整理' }, 400);

  const dailyBudget = Math.max(0, Number(env.MARKETING_CLINIC_DAILY_BUDGET_USD) || 5);
  if (!session.summary && dailyBudget && await getDailyBudgetUsage(env) >= dailyBudget) {
    return jsonResponse({ ok: false, message: '今日診斷服務額度已用完，請明天再產生摘要' }, 503);
  }
  const result = session.summary ? {
    topic: session.topic,
    summary: session.summary,
    lead_category: session.lead_category,
    lead_score: session.lead_score,
    recommended_service: session.recommended_service,
    usage: {},
    model: null
  } : await buildSummary(env, messages, Boolean(session.visitor_email));
  const inputTokens = Number(result.usage.input_tokens) || 0;
  const outputTokens = Number(result.usage.output_tokens) || 0;
  const updates = {
    topic: result.topic,
    summary: result.summary,
    lead_category: result.lead_category,
    lead_score: result.lead_score,
    recommended_service: result.recommended_service,
    status: 'completed',
    completed_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    input_tokens: Number(session.input_tokens || 0) + inputTokens,
    output_tokens: Number(session.output_tokens || 0) + outputTokens,
    estimated_cost_usd: Number(session.estimated_cost_usd || 0) + (result.model ? estimateOpenAiCost(result.model, inputTokens, outputTokens, env) : 0)
  };
  if (result.model) {
    await supabaseRequest(env, 'chat_messages', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        session_id: sessionId,
        role: 'system',
        content: '產生診斷摘要與商機分類',
        usage_type: 'summary',
        model_name: result.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimateOpenAiCost(result.model, inputTokens, outputTokens, env)
      })
    });
  }

  if (body.requestConsultation && session.visitor_name && session.visitor_email && session.visitor_phone && !session.consultation_requested_at) {
    await supabaseRequest(env, 'contact_inquiries', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: session.visitor_name,
        company: session.company_name || '未提供',
        contact: session.visitor_phone,
        service: result.recommended_service || '行銷診斷後續諮詢',
        message: `Email：${session.visitor_email}\n\n${result.summary}`,
        source: 'marketing-clinic',
        created_at: new Date().toISOString()
      })
    });
    updates.consultation_requested_at = new Date().toISOString();
  }

  await supabaseRequest(env, `chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(updates)
  });
  return jsonResponse({ ok: true, summary: updates, consultationCreated: Boolean(updates.consultation_requested_at) });
}
