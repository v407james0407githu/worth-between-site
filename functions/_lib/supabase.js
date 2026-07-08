export const getSupabaseConfig = (env) => {
  const baseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !apiKey) return null;
  const keyProjectRef = (() => {
    try {
      const payload = JSON.parse(atob(apiKey.split('.')[1] || ''));
      return payload?.ref || payload?.project_ref || null;
    } catch {
      return null;
    }
  })();
  return {
    baseUrl,
    apiKey,
    keyProjectRef,
    host: (() => {
      try {
        return new URL(baseUrl).host;
      } catch {
        return baseUrl;
      }
    })(),
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json'
    }
  };
};
