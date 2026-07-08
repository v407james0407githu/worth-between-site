import { requireAdminSession } from '../_lib/admin-auth.js';
import { jsonResponse } from '../_lib/http.js';
import { getSupabaseConfig } from '../_lib/supabase.js';

const DEFAULT_BUCKET = 'site-assets';
const MAX_STORED_IMAGE_BYTES = 512 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/svg+xml']);

const sanitizeFilenamePart = (value) => String(value || 'image')
  .toLowerCase()
  .replace(/\.[a-z0-9]+$/i, '')
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'image';

const readResponseText = async (response) => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const ensureBucket = async (config, bucket) => {
  const response = await fetch(`${config.baseUrl}/rest/v1/storage.buckets?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...config.headers,
      prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: MAX_STORED_IMAGE_BYTES,
      allowed_mime_types: Array.from(ALLOWED_MIME_TYPES)
    })
  });
  if (response.ok) return { ok: true };
  return { ok: false, detail: await readResponseText(response) || `storage.buckets upsert failed with HTTP ${response.status}` };
};

export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);

  const config = getSupabaseConfig(env);
  if (!config) return jsonResponse({ ok: false, message: '圖片儲存服務尚未設定' }, 503);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ ok: false, message: '圖片上傳格式錯誤' }, 400);
  }

  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return jsonResponse({ ok: false, message: '缺少圖片檔案' }, 400);
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return jsonResponse({ ok: false, message: '不支援的圖片格式' }, 400);
  }
  if (file.size > MAX_STORED_IMAGE_BYTES) {
    return jsonResponse({ ok: false, message: '圖片壓縮後仍超過 512 KB，請改用較小圖片' }, 413);
  }

  const bucket = env.SUPABASE_SITE_ASSETS_BUCKET || DEFAULT_BUCKET;
  const bucketReady = await ensureBucket(config, bucket);
  if (!bucketReady.ok) {
    console.error('Supabase image bucket setup failed:', bucketReady.detail || 'unknown');
    return jsonResponse({
      ok: false,
      message: `無法建立或讀取 Supabase 圖片 bucket${bucketReady.detail ? `：${bucketReady.detail}` : ''}`
    }, 502);
  }

  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const randomId = crypto.randomUUID();
  const name = sanitizeFilenamePart(file.name);
  const extension = file.type === 'image/webp' ? 'webp' : file.type.split('/')[1] || 'bin';
  const objectPath = `${folder}/${randomId}-${name}.${extension}`;
  const body = await file.arrayBuffer();

  const upload = await fetch(`${config.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: config.apiKey,
      authorization: `Bearer ${config.apiKey}`,
      'content-type': file.type,
      'cache-control': '31536000, immutable',
      'x-upsert': 'false'
    },
    body
  });

  if (!upload.ok) {
    const detail = await readResponseText(upload);
    console.error('Supabase image upload failed:', detail || `HTTP ${upload.status}`);
    return jsonResponse({
      ok: false,
      message: `圖片上傳到 Supabase 失敗${detail ? `：${detail}` : ''}`
    }, 502);
  }

  const publicUrl = `${config.baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
  return jsonResponse({
    ok: true,
    url: publicUrl,
    path: objectPath,
    bucket,
    size: file.size
  });
}
