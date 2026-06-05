const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const cleanText = (value, maxLength = 1000) => String(value || '').trim().slice(0, maxLength);
const isEmailAddress = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

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

const formatInquiryEmail = (inquiry) => {
  const rows = [
    ['姓名', inquiry.name],
    ['公司名稱', inquiry.company],
    ['聯絡方式', inquiry.contact],
    ['最想解決的問題', inquiry.service || '未選擇'],
    ['簡單說明需求', inquiry.message || '未填寫'],
    ['送出時間', inquiry.created_at]
  ];
  const text = rows.map(([label, value]) => `${label}：${value}`).join('\n');
  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;background:#f9fafb;width:150px;">${escapeHtml(label)}</th>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:pre-line;">${escapeHtml(value)}</td>
    </tr>
  `).join('');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans TC','Microsoft JhengHei',Arial,sans-serif;color:#1f2329;line-height:1.7;">
      <h1 style="font-size:22px;margin:0 0 16px;">沃蒔之間網站諮詢通知</h1>
      <p style="margin:0 0 18px;color:#4b5563;">網站收到一筆新的專案諮詢，內容如下：</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">${htmlRows}</table>
    </div>
  `;
  return { text, html };
};

const sendInquiryEmail = async (env, inquiry, requestedRecipient) => {
  const token = env.CF_EMAIL_API_TOKEN || env.CF_API_TOKEN;
  const accountId = env.CF_ACCOUNT_ID;
  const to = cleanText(env.CONTACT_INQUIRY_TO_EMAIL || requestedRecipient || '', 160);
  const fromAddress = cleanText(env.CONTACT_INQUIRY_FROM_EMAIL || 'no-reply@worthbetween.com', 160);
  const fromName = cleanText(env.CONTACT_INQUIRY_FROM_NAME || '沃蒔之間網站', 80);

  if (!accountId || !token) {
    return { sent: false, reason: '尚未設定 Cloudflare Email Sending 環境變數' };
  }
  if (!isEmailAddress(to)) {
    return { sent: false, reason: '收件 Email 格式不正確' };
  }
  if (!isEmailAddress(fromAddress)) {
    return { sent: false, reason: '寄件 Email 格式不正確' };
  }

  const { text, html } = formatInquiryEmail(inquiry);
  const payload = {
    to,
    from: { address: fromAddress, name: fromName },
    subject: `網站諮詢：${inquiry.company}｜${inquiry.name}`,
    text,
    html
  };
  if (isEmailAddress(inquiry.contact)) {
    payload.reply_to = { address: inquiry.contact, name: inquiry.name };
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    const message = result.errors?.[0]?.message || `Cloudflare Email HTTP ${response.status}`;
    return { sent: false, reason: message };
  }
  return { sent: true };
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
  const recipientEmail = cleanText(body.recipientEmail, 160);

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

  let stored = insertResponse.ok;

  if (!stored) {
    try {
      await appendToSiteState(env, inquiry);
      stored = true;
    } catch (error) {
      return jsonResponse({
        ok: false,
        message: error.message || '諮詢送出失敗，請稍後再試'
      }, 500);
    }
  }

  const emailResult = await sendInquiryEmail(env, inquiry, recipientEmail);
  if (!emailResult.sent) {
    return jsonResponse({
      ok: true,
      emailSent: false,
      message: `諮詢已送出，但通知信未寄出：${emailResult.reason}`
    });
  }

  return jsonResponse({ ok: true, emailSent: true, message: '諮詢已送出，通知信已寄出' });
}
