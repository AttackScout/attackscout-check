'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/main');
const { KEY_URL, PRICING_URL } = require('../src/links');
const { evaluate, parseOptions, normalizeDomain } = require('../src/check');

const KEY = 'as_test_' + 'a'.repeat(48);

function scan(grade, findings = [], extra = {}) {
  return { id: 'tok123', domain: 'example.com', grade, findings, ...extra };
}

// Serveur simulé : répond selon le scénario, garde la dernière requête.
async function withServer(handler, fn) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      handler(req, res);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, seen); }
  finally { srv.close(); }
}

function reply(status, obj, headers = {}) {
  return (_req, res) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
}

function tmpEnv(url, inputs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asact-'));
  const env = {
    INPUT_DOMAIN: 'example.com', 'INPUT_API-KEY': KEY, 'INPUT_API-URL': url, 
    GITHUB_OUTPUT: path.join(dir, 'out'), GITHUB_STEP_SUMMARY: path.join(dir, 'sum'),
  };
  for (const [k, v] of Object.entries(inputs || {})) { env['INPUT_' + k.toUpperCase()] = v; }
  fs.writeFileSync(env.GITHUB_OUTPUT, ''); fs.writeFileSync(env.GITHUB_STEP_SUMMARY, '');
  return env;
}

function quiet() {
  const log = console.log; const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  return { lines, restore: () => (console.log = log) };
}

test('grade au-dessus du seuil : succès, sortie et résumé', async () => {
  await withServer(reply(201, scan('B', [{ id: 'A1', family: 'email', status: 'fail', severity: 'low', code: 'spf_soft' }])), async (url, seen) => {
    const env = tmpEnv(url, { 'min-grade': 'C' });
    const q = quiet();
    const code = await run(env);
    q.restore();
    assert.strictEqual(code, 0);
    assert.strictEqual(seen[0].method, 'POST');
    assert.strictEqual(seen[0].url, '/api/v1/public/scans');
    assert.strictEqual(seen[0].auth, 'Bearer ' + KEY);
    assert.deepStrictEqual(JSON.parse(seen[0].body), { domain: 'example.com' });
    assert.match(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), /grade=B\nfailed-count=1\nworst-severity=low\nscan-id=tok123\npassed=true/);
    assert.match(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /PASSED - grade \*\*B\*\*/);
  });
});

test('grade sous le seuil : échec', async () => {
  await withServer(reply(200, scan('E')), async (url) => {
    const env = tmpEnv(url, { 'min-grade': 'C' });
    const q = quiet();
    const code = await run(env);
    q.restore();
    assert.strictEqual(code, 1);
    assert.ok(q.lines.some((l) => l.includes('grade E is below the minimum C')));
    assert.match(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /FAILED/);
  });
});

test('seuil de gravité', async () => {
  const f = [{ id: 'A5', family: 'tls', status: 'fail', severity: 'high', code: 'cert_soon' }];
  await withServer(reply(201, scan('A', f)), async (url) => {
    const q = quiet();
    assert.strictEqual(await run(tmpEnv(url, { 'fail-on-severity': 'high' })), 1);
    assert.strictEqual(await run(tmpEnv(url, { 'fail-on-severity': 'critical' })), 0);
    q.restore();
  });
});

test('erreurs API : 401, 429, clé jamais affichée', async () => {
  await withServer(reply(401, { error: { code: 'invalid_key', message: KEY } }), async (url) => {
    const q = quiet();
    assert.strictEqual(await run(tmpEnv(url)), 1);
    q.restore();
    assert.ok(q.lines.some((l) => l.includes('error 401 invalid_key')));
    assert.ok(!q.lines.slice(1).some((l) => l.includes(KEY)));
  });
  await withServer(reply(429, { error: { code: 'scan_quota_exceeded' } }, { 'Retry-After': '120' }), async (url) => {
    const q = quiet();
    assert.strictEqual(await run(tmpEnv(url)), 1);
    q.restore();
    assert.ok(q.lines.some((l) => l.includes('retry after 120 s')));
  });
});

test('serveur injoignable et entrées invalides', async () => {
  const q = quiet();
  assert.strictEqual(await run(tmpEnv('http://127.0.0.1:1')), 1);
  assert.strictEqual(await run(tmpEnv('http://127.0.0.1:1', { 'min-grade': 'Z' })), 1);
  assert.strictEqual(await run(tmpEnv('http://127.0.0.1:1', { domain: 'localhost' })), 1);
  q.restore();
});

test('clé absente ou vide : message actionnable avec le lien, aucun appel réseau', async () => {
  for (const mod of [(e) => { e['INPUT_API-KEY'] = ''; }, (e) => { delete e['INPUT_API-KEY']; }]) {
    await withServer(reply(201, scan('A')), async (url, seen) => {
      const env = tmpEnv(url); mod(env);
      const q = quiet();
      assert.strictEqual(await run(env), 1);
      q.restore();
      assert.ok(q.lines.some((l) => l.includes('api-key is required') && l.includes(KEY_URL)));
      assert.strictEqual(seen.length, 0);
    });
  }
});

test('403 : renvoie vers la page de création de clé', async () => {
  await withServer(reply(403, { error: { code: 'insufficient_scope' } }), async (url) => {
    const q = quiet();
    assert.strictEqual(await run(tmpEnv(url)), 1);
    q.restore();
    assert.ok(q.lines.some((l) => l.includes('error 403') && l.includes(KEY_URL)));
  });
});

test('résumé : lien Surveiller ce domaine en dernière ligne', async () => {
  await withServer(reply(201, scan('A')), async (url) => {
    const env = tmpEnv(url);
    const q = quiet();
    await run(env);
    q.restore();
    const md = fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8').trim().split('\n');
    assert.strictEqual(md[md.length - 1], `[Surveiller ce domaine](${PRICING_URL})`);
    assert.ok(PRICING_URL.startsWith('https://attackscout.com/fr/tarifs?utm_source=github-action&utm_medium=ci&utm_campaign=github-action-check'));
  });
});

test('action.yml : conforme au Marketplace', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8');
  assert.match(yml, /^name: 'AttackScout Check'$/m);
  assert.ok(yml.match(/^description: '(.*)'$/m)[1].length <= 125);
  assert.match(yml, /icon: 'shield'/);
  assert.match(yml, /color: 'blue'/);
  assert.match(yml, /using: 'node20'/);
});

test('preparer-depot : copie sans PUBLICATION.md', () => {
  const { spawnSync } = require('node:child_process');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asdep-')), 'depot');
  const script = path.join(__dirname, '..', 'scripts', 'preparer-depot.mjs');
  const r = spawnSync(process.execPath, [script, out], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  for (const f of ['action.yml', 'README.md', 'src/main.js', 'examples/basic.yml']) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.ok(!fs.existsSync(path.join(out, 'PUBLICATION.md')));
  assert.strictEqual(spawnSync(process.execPath, [script, out], { encoding: 'utf8' }).status, 2);
});

test('evaluate : note partielle et constats remplacés', () => {
  const opts = parseOptions({ minGrade: 'B', failOnSeverity: 'none', failOnPartial: 'true' });
  assert.strictEqual(evaluate(scan(''), opts).passed, false);
  assert.strictEqual(evaluate(scan(''), { ...opts, failOnPartial: false }).passed, true);
  const r = scan('A', [{ id: 'X', status: 'fail', severity: 'blocking', superseded: true }]);
  assert.strictEqual(evaluate(r, { ...opts, failOnSeverity: 'low' }).failed.length, 0);
});

test('normalizeDomain', () => {
  assert.strictEqual(normalizeDomain(' HTTPS://Example.com/path?x=1 '), 'example.com');
  assert.throws(() => normalizeDomain(''));
});
