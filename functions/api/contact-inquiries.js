const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const cleanText = (value, maxLength = 1000) => String(value || '').trim().slice(0, maxLength);

const getSupabaseHeaders = (env) => {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return {
    apikey: apiKey,
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json'
  };
};

const appendToSiteState = async (env, inquiry) => {
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = getSupabaseHeaders(env);
  const currentResponse = await fetch(`${baseUrl}/rest/v1/site_state?site_id=eq.primary&select=payload&limit=1`, { headers });
  if (!currentResponse.ok) {
    throw new Error('無法讀取站台資料備援儲存');
  }
  const rows = await currentResponse.json();
  const payload = rows?.[0]?.payload && typeof rows[0].payload === 'object' ? rows[0].payload : {};
  const contactInquiries = Array.isArray(payload.contactInquiries) ? payload.contactInquiries : [];
  const nextPayload = {
    ...payload,
    contactInquiries: [inquiry, ...contactInquiries].slice(0, 500)
  };

  const updateResponse = await fetch(`${baseUrl}/rest/v1/site_state?site_id=eq.primary`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      payload: nextPayload,
      updated_at: new Date().toISOString()
    })
  });
  if (!updateResponse.ok) {
    throw new Error('無法寫入站台資料備援儲存');
  }
};

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)) {
    return jsonResponse({ ok: false, message: '網站尚未設定諮詢資料儲存環境' }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: '送出資料格式錯誤' }, 400);
  }

  const inquiry = {
    id: crypto.randomUUID(),
    name: cleanText(body.name, 80),
    company: cleanText(body.company, 120),
    contact: cleanText(body.contact, 160),
    service: cleanText(body.service, 160),
    message: cleanText(body.message, 1500),
    source: 'homepage-contact',
    created_at: new Date().toISOString()
  };

  const missingFields = [];
  if (!inquiry.name) missingFields.push('姓名');
  if (!inquiry.company) missingFields.push('公司名稱');
  if (!inquiry.contact) missingFields.push('聯絡方式');
  if (missingFields.length) {
    return jsonResponse({ ok: false, message: `請填寫${missingFields.join('、')}` }, 400);
  }

  const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = getSupabaseHeaders(env);
  const insertResponse = await fetch(`${baseUrl}/rest/v1/contact_inquiries`, {
    method: 'POST',
    headers,
    body: JSON.stringify(inquiry)
  });

  if (insertResponse.ok) {
    return jsonResponse({ ok: true, message: '諮詢已送出' });
  }

  try {
    await appendToSiteState(env, inquiry);
    return jsonResponse({ ok: true, message: '諮詢已送出' });
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error.message || '諮詢送出失敗，請稍後再試'
    }, 500);
  }
}
