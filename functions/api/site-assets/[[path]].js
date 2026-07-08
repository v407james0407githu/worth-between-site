const KV_ASSET_PREFIX = 'assets';

const getAssetPath = (params) => {
  const value = params?.path;
  if (Array.isArray(value)) return value.join('/');
  return String(value || '');
};

export async function onRequestGet({ params, env }) {
  if (!env.WORTH_BETWEEN_STORAGE) return new Response('Asset storage is not configured', { status: 503 });

  const assetPath = getAssetPath(params);
  if (!assetPath || assetPath.includes('..')) return new Response('Not found', { status: 404 });

  const key = `${KV_ASSET_PREFIX}/${assetPath}`;
  const result = await env.WORTH_BETWEEN_STORAGE.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!result?.value) return new Response('Not found', { status: 404 });

  const metadata = result.metadata || {};
  return new Response(result.value, {
    headers: {
      'content-type': metadata.contentType || 'application/octet-stream',
      'cache-control': metadata.cacheControl || 'public, max-age=31536000, immutable'
    }
  });
}
