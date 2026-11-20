# AttackScout Check

A GitHub Action that audits what the Internet sees of your domain (grade A to F, SSL certificate, DNS, SPF/DKIM/DMARC, deadlines, exposed software) and fails the workflow when it gets worse.

Part of [AttackScout](https://attackscout.com/en?utm_source=github&utm_medium=repo&utm_campaign=attackscout-check): what an attacker can see of your site from the Internet, explained simply, with the fix.

## Get a free API key

1. Create a key (free account, no card): [https://attackscout.com/espace/cles?utm_source=github-action&utm_medium=ci&utm_campaign=github-action-cle](https://attackscout.com/espace/cles?utm_source=github-action&utm_medium=ci&utm_campaign=github-action-cle). Channel `github_action`, scope `scans:write`. The key is shown once.
2. Add it as the repository secret `ATTACKSCOUT_API_KEY` (Settings > Secrets and variables > Actions).

## Usage

```yaml
name: AttackScout
on:
  push:
    branches: [main]
  schedule:
    - cron: '17 6 * * 1'
jobs:
  attackscout:
    runs-on: ubuntu-latest
    steps:
      - uses: AttackScout/attackscout-check@v1
        with:
          domain: example.com
          api-key: ${{ secrets.ATTACKSCOUT_API_KEY }}
          min-grade: C
          fail-on-severity: critical
```

No checkout is needed. The job summary lists the findings and the upcoming deadlines.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `domain` | required | Domain to audit |
| `api-key` | required | API key, from a secret |
| `min-grade` | `C` | Lowest accepted grade, A (best) to F. Empty: no threshold |
| `fail-on-severity` | `none` | `low`, `medium`, `high`, `critical`, `blocking` or `none` |
| `fail-on-partial` | `false` | Fail when the grade is partial |
| `api-url` | `https://attackscout.com` | API base URL |
| `timeout-seconds` | `90` | Request timeout |

Outputs: `grade`, `failed-count`, `worst-severity`.

## Limits

Free account quotas, per API key: 600 requests per hour and 100 audit requests per day (300 per day across all the keys of an account). A result less than 24 hours old is served from cache and still counts. Over quota the API answers HTTP 429 with a `Retry-After` header.

## Privacy

No tracker, no telemetry, nothing stored on your machine. The only data sent is the domain name you ask about, with your API key, to `https://attackscout.com`. The audit only reads what is public.

## License

MIT
