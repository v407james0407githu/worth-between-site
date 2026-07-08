import { requireAdminSession } from '../_lib/admin-auth.js';
import { jsonResponse } from '../_lib/http.js';

const KV_ASSET_PREFIX = 'assets';
const MAX_STORED_IMAGE_BYTES = 512 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/svg+xml']);

const sanitizeFilenamePart = (value) => String(value || 'image')
  .toLowerCase()
  .replace(/\.[a-z0-9]+$/i, '')
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'image';

export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);

  if (!env.WORTH_BETWEEN_STORAGE) {
    return jsonResponse({ ok: false, message: 'Cloudflare 圖片儲存空間尚未設定' }, 503);
  }

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

  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const randomId = crypto.randomUUID();
  const name = sanitizeFilenamePart(file.name);
  const extension = file.type === 'image/webp' ? 'webp' : file.type.split('/')[1] || 'bin';
  const objectPath = `${folder}/${randomId}-${name}.${extension}`;
  const body = await file.arrayBuffer();

  const key = `${KV_ASSET_PREFIX}/${objectPath}`;
  await env.WORTH_BETWEEN_STORAGE.put(key, body, {
    metadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000, immutable'
    },
  });
  const origin = new URL(request.url).origin;
  return jsonResponse({
    ok: true,
    url: `${origin}/api/site-assets/${objectPath}`,
    path: objectPath,
    bucket: 'cloudflare-kv',
    size: file.size
  });
}
