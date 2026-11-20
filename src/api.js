'use strict';
const { KEY_URL } = require('./links');

// POST /api/v1/public/scans (200 cache, 201 nouvel audit).
async function runScan({ apiUrl, apiKey, domain, timeoutMs, fetchImpl = fetch }) {
  const base = apiUrl.replace(/\/+$/, '');
  let res;
  try {
    res = await fetchImpl(`${base}/api/v1/public/scans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'attackscout-github-action/0.1',
      },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(`AttackScout API unreachable: ${e.message}`);
  }
  if (res.status === 200 || res.status === 201) return res.json();
  let code = '';
  try { code = (await res.json()).error?.code || ''; } catch { /* corps non JSON */ }
  let hint = '';
  if (res.status === 401) hint = ` (API key refused: check the api-key secret, or create a free key at ${KEY_URL})`;
  if (res.status === 403) hint = ` (scope scans:write missing, or domain excluded: create a free key with this scope at ${KEY_URL})`;
  if (res.status === 429) hint = ` (quota reached, retry after ${res.headers.get('Retry-After') || '?'} s)`;
  throw new Error(`AttackScout API error ${res.status}${code ? ' ' + code : ''}${hint}`);
}

module.exports = { runScan };
