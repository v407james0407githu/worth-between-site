export const getSupabaseConfig = (env) => {
  const baseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json'
    }
  };
};
