'use strict';
const fs = require('node:fs');
const { runScan } = require('./api');
const { KEY_URL } = require('./links');
const { parseOptions, normalizeDomain, evaluate, summary } = require('./check');

function input(name, env) {
  return (env[`INPUT_${name.toUpperCase()}`] || '').trim();
}

function setOutput(name, value, env) {
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

// Retourne le code de sortie. La clé est masquée dans les journaux.
async function run(env = process.env, fetchImpl = fetch) {
  const out = (n, v) => setOutput(n, v, env);
  const apiKey = input('api-key', env);
  try {
    if (!apiKey) throw new Error(`api-key is required. Create a free API key (scope scans:write, channel github_action) at ${KEY_URL} and store it as the repository secret ATTACKSCOUT_API_KEY.`);
    console.log(`::add-mask::${apiKey}`);
    const domain = normalizeDomain(input('domain', env));
    const opts = parseOptions({
      minGrade: env['INPUT_MIN-GRADE'] !== undefined ? env['INPUT_MIN-GRADE'] : 'C',
      failOnSeverity: input('fail-on-severity', env),
      failOnPartial: input('fail-on-partial', env),
    });
    const apiUrl = input('api-url', env) || 'https://attackscout.com';
    const timeoutMs = (Number(input('timeout-seconds', env)) || 90) * 1000;
    const result = await runScan({ apiUrl, apiKey, domain, timeoutMs, fetchImpl });
    const verdict = evaluate(result, opts);
    out('grade', result.grade || '');
    out('failed-count', verdict.failed.length);
    out('worst-severity', verdict.worst);
    out('scan-id', result.id || '');
    out('passed', verdict.passed);
    const md = summary(result, verdict, opts, apiUrl.replace(/\/+$/, ''));
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n');
    console.log(`AttackScout: ${domain} grade ${result.grade || 'partial'}, ${verdict.failed.length} failed check(s)`);
    for (const r of verdict.reasons) console.log(`::error title=AttackScout Check::${r}`);
    return verdict.passed ? 0 : 1;
  } catch (e) {
    const msg = apiKey ? e.message.split(apiKey).join('***') : e.message;
    console.log(`::error title=AttackScout Check::${msg}`);
    return 1;
  }
}

if (require.main === module) run().then((c) => { process.exitCode = c; });

module.exports = { run };
