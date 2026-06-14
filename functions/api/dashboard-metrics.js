import { requireAdminSession } from '../_lib/admin-auth.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const addValue = (current, next) => {
  const currentNumber = toNumber(current) || 0;
  const nextNumber = toNumber(next) || 0;
  return currentNumber + nextNumber;
};

const makePercentRows = (rows) => {
  const total = rows.reduce((sum, row) => sum + (toNumber(row.value) || 0), 0);
  return rows.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round(((toNumber(row.value) || 0) / total) * 1000) / 10 : 0
  }));
};

const normalizeDailyRows = (groups, dateKey = 'date') => groups
  .map((group) => ({
    date: group?.dimensions?.[dateKey] || '',
    pageviews: toNumber(group?.count) || toNumber(group?.sum?.pageViews) || 0,
    visitors: toNumber(group?.sum?.visits) || toNumber(group?.uniq?.uniques) || 0,
    requests: toNumber(group?.sum?.requests) || 0,
    bandwidthBytes: toNumber(group?.sum?.bytes) || 0
  }))
  .filter((row) => row.date)
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));

const normalizeRows = (groups, dimensionKey, fallbackLabel = '未分類') => {
  const merged = new Map();
  groups.forEach((group) => {
    const label = group?.dimensions?.[dimensionKey] || fallbackLabel;
    const count = toNumber(group?.count) || toNumber(group?.sum?.requests) || 0;
    merged.set(label, (merged.get(label) || 0) + count);
  });
  return Array.from(merged, ([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
};

const graphqlRequest = async (env, query, variables) => {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.[0]?.message || `Cloudflare API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.data;
};

const getDateRange = () => {
  const untilDate = new Date();
  const sinceDate = new Date();
  sinceDate.setDate(untilDate.getDate() - 13);
  return {
    sinceDate: sinceDate.toISOString().slice(0, 10),
    untilDate: untilDate.toISOString().slice(0, 10),
    sinceDateTime: `${sinceDate.toISOString().slice(0, 10)}T00:00:00Z`,
    untilDateTime: `${untilDate.toISOString().slice(0, 10)}T23:59:59Z`
  };
};

const fetchCloudflareZoneMetrics = async (env) => {
  const { sinceDate, untilDate, sinceDateTime, untilDateTime } = getDateRange();
  const query = `
    query WorthBetweenDashboard($zoneTag: string, $sinceDate: Date, $untilDate: Date, $sinceDateTime: Time, $untilDateTime: Time) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          totals: httpRequests1dGroups(limit: 7, filter: { date_geq: $sinceDate, date_leq: $untilDate }) {
            sum {
              requests
              bytes
              pageViews
            }
            uniq {
              uniques
            }
          }
          daily: httpRequests1dGroups(limit: 14, filter: { date_geq: $sinceDate, date_leq: $untilDate }, orderBy: [date_ASC]) {
            dimensions {
              date
            }
            sum {
              requests
              bytes
              pageViews
            }
            uniq {
              uniques
            }
          }
          sources: httpRequestsAdaptiveGroups(limit: 50, filter: { datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              refererHost
            }
          }
          pages: httpRequestsAdaptiveGroups(limit: 50, filter: { datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              clientRequestPath
            }
          }
          countries: httpRequestsAdaptiveGroups(limit: 50, filter: { datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              clientCountryName
            }
          }
          devices: httpRequestsAdaptiveGroups(limit: 20, filter: { datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              clientDeviceType
            }
          }
        }
      }
    }
  `;
  const data = await graphqlRequest(env, query, {
    zoneTag: env.CF_ZONE_ID,
    sinceDate,
    untilDate,
    sinceDateTime,
    untilDateTime
  });
  const zone = data?.viewer?.zones?.[0];
  if (!zone) {
    throw new Error('Cloudflare 找不到指定 Zone');
  }

  const traffic = {
    visitors: null,
    pageviews: null,
    requests: null,
    bandwidthBytes: null,
    sources: normalizeRows(zone.sources || [], 'refererHost', '直接流量'),
    topPages: normalizeRows(zone.pages || [], 'clientRequestPath', '/'),
    countries: normalizeRows(zone.countries || [], 'clientCountryName', '未知國家'),
    devices: makePercentRows(normalizeRows(zone.devices || [], 'clientDeviceType', '未知裝置')),
    daily: normalizeDailyRows(zone.daily || [])
  };

  (zone.totals || []).forEach((group) => {
    traffic.visitors = addValue(traffic.visitors, group?.uniq?.uniques);
    traffic.pageviews = addValue(traffic.pageviews, group?.sum?.pageViews);
    traffic.requests = addValue(traffic.requests, group?.sum?.requests);
    traffic.bandwidthBytes = addValue(traffic.bandwidthBytes, group?.sum?.bytes);
  });

  return traffic;
};

const fetchCloudflareWebAnalyticsMetrics = async (env) => {
  const { sinceDateTime, untilDateTime } = getDateRange();
  const query = `
    query WorthBetweenWebAnalytics($accountTag: string, $siteTag: string, $sinceDateTime: Time, $untilDateTime: Time) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          totals: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { siteTag: $siteTag, datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            sum {
              visits
            }
          }
          daily: rumPageloadEventsAdaptiveGroups(limit: 14, filter: { siteTag: $siteTag, datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }, orderBy: [date_ASC]) {
            count
            sum {
              visits
            }
            dimensions {
              date
            }
          }
          sources: rumPageloadEventsAdaptiveGroups(limit: 50, filter: { siteTag: $siteTag, datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              refererHost
            }
          }
          pages: rumPageloadEventsAdaptiveGroups(limit: 50, filter: { siteTag: $siteTag, datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              requestPath
            }
          }
          countries: rumPageloadEventsAdaptiveGroups(limit: 50, filter: { siteTag: $siteTag, datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              countryName
            }
          }
          devices: rumPageloadEventsAdaptiveGroups(limit: 20, filter: { siteTag: $siteTag, datetime_geq: $sinceDateTime, datetime_leq: $untilDateTime }) {
            count
            dimensions {
              deviceType
            }
          }
        }
      }
    }
  `;
  const data = await graphqlRequest(env, query, {
    accountTag: env.CF_ACCOUNT_ID,
    siteTag: env.CF_WEB_ANALYTICS_TOKEN,
    sinceDateTime,
    untilDateTime
  });
  const account = data?.viewer?.accounts?.[0];
  if (!account) {
    throw new Error('Cloudflare 找不到指定帳號');
  }

  const traffic = {
    visitors: null,
    pageviews: null,
    requests: null,
    bandwidthBytes: null,
    sources: normalizeRows(account.sources || [], 'refererHost', '直接流量'),
    topPages: normalizeRows(account.pages || [], 'requestPath', '/'),
    countries: normalizeRows(account.countries || [], 'countryName', '未知國家'),
    devices: makePercentRows(normalizeRows(account.devices || [], 'deviceType', '未知裝置')),
    daily: normalizeDailyRows(account.daily || [])
  };

  (account.totals || []).forEach((group) => {
    traffic.visitors = addValue(traffic.visitors, group?.sum?.visits);
    traffic.pageviews = addValue(traffic.pageviews, group?.count);
  });

  return traffic;
};

const fetchCloudflareMetrics = async (env) => {
  if (env.CF_ACCOUNT_ID && env.CF_WEB_ANALYTICS_TOKEN) {
    return fetchCloudflareWebAnalyticsMetrics(env);
  }
  return fetchCloudflareZoneMetrics(env);
};

const fetchSupabaseMetrics = async (env) => {
  const baseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const headers = {
    apikey: apiKey,
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json'
  };

  let siteStateBytes = null;
  let siteStateUpdatedAt = null;
  const siteStateResponse = await fetch(`${baseUrl}/rest/v1/site_state?site_id=eq.primary&select=payload,updated_at&limit=1`, { headers });
  if (siteStateResponse.ok) {
    const rows = await siteStateResponse.json();
    const payload = rows?.[0]?.payload || {};
    siteStateBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    siteStateUpdatedAt = rows?.[0]?.updated_at || null;
  }

  let storageUsedBytes = null;
  const storageResponse = await fetch(`${baseUrl}/rest/v1/storage.objects?select=metadata&limit=10000`, { headers });
  if (storageResponse.ok) {
    const rows = await storageResponse.json();
    storageUsedBytes = rows.reduce((sum, row) => sum + (toNumber(row?.metadata?.size) || 0), 0);
  }

  const quotaBytes = toNumber(env.SUPABASE_STORAGE_QUOTA_BYTES);
  const usedBytes = storageUsedBytes ?? siteStateBytes;
  return {
    siteStateBytes,
    siteStateUpdatedAt,
    supabaseStorageUsedBytes: usedBytes,
    supabaseStorageRemainingBytes: quotaBytes == null || usedBytes == null ? null : Math.max(0, quotaBytes - usedBytes),
    supabaseStorageQuotaBytes: quotaBytes
  };
};

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) {
    return jsonResponse({ ok: false, message: '登入已失效，請重新登入' }, 401);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    traffic: {
      visitors: null,
      pageviews: null,
      requests: null,
      bandwidthBytes: null,
      sources: [],
      topPages: [],
      countries: [],
      devices: [],
      daily: []
    },
    resources: {
      siteStateBytes: null,
      siteStateUpdatedAt: null,
      supabaseStorageUsedBytes: null,
      supabaseStorageRemainingBytes: null,
      supabaseStorageQuotaBytes: null
    },
    status: {
      cloudflareConfigured: Boolean(env.CF_API_TOKEN && ((env.CF_ACCOUNT_ID && env.CF_WEB_ANALYTICS_TOKEN) || env.CF_ZONE_ID)),
      cloudflareMode: env.CF_ACCOUNT_ID && env.CF_WEB_ANALYTICS_TOKEN ? 'web-analytics' : 'zone-analytics',
      supabaseConfigured: Boolean(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)),
      errors: []
    }
  };

  if (result.status.cloudflareConfigured) {
    try {
      result.traffic = await fetchCloudflareMetrics(env);
    } catch (error) {
      result.status.errors.push(`Cloudflare 數據讀取失敗：${error.message}`);
    }
  } else {
    result.status.errors.push('Cloudflare API 尚未設定');
  }

  if (result.status.supabaseConfigured) {
    try {
      result.resources = await fetchSupabaseMetrics(env);
    } catch (error) {
      result.status.errors.push(`Supabase 數據讀取失敗：${error.message}`);
    }
  } else {
    result.status.errors.push('Supabase API 尚未設定');
  }

  return jsonResponse(result);
}
