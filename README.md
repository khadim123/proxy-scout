# proxy-scout

A lightweight CLI and Node.js library for checking HTTP/HTTPS proxy health, latency, and exit IP.

`proxy-scout` is built for developers who need a quick way to validate proxy lists before using them in scraping, automation, or infrastructure workflows. It tests proxies against a target URL, reports status/latency, and extracts the observed exit IP when available.

## Features

- **HTTP/HTTPS proxy checks** - validates proxies through real requests.
- **Latency measurement** - reports per-proxy response time in milliseconds.
- **Exit IP detection** - extracts IP from JSON responses (e.g., `ipify`) or plain text.
- **CLI + library** - use it in scripts or import it into Node.js/TypeScript projects.
- **Concurrent checks** - test large lists with configurable concurrency.
- **JSON output** - easy to pipe into other tools.

## Install

```bash
npm install
npm run build
```

To run directly in development:

```bash
npm run dev -- http://127.0.0.1:8080
```

After building, you can link the CLI locally:

```bash
npm link
proxy-scout --help
```

## CLI Usage

```bash
proxy-scout <proxy...> [options]
proxy-scout --file proxies.txt [options]
```

### Options

| Option | Description | Default |
|---|---|---|
| `--file <path>` | Read proxies from a file (one per line, `#` comments allowed) | - |
| `--target <url>` | Target URL to request through the proxy | `https://api.ipify.org?format=json` |
| `--timeout <ms>` | Timeout per proxy check | `10000` |
| `--concurrency <n>` | Concurrent checks | `5` |
| `--json` | Output results as JSON | `false` |
| `--help` | Show help | - |

### Examples

Check a single proxy:

```bash
proxy-scout http://127.0.0.1:8080
```

Check multiple proxies with JSON output:

```bash
proxy-scout http://proxy1:8080 http://user:pass@proxy2:8080 --json
```

Check a file with concurrency:

```bash
proxy-scout --file proxies.txt --concurrency 10 --timeout 8000
```

Example `proxies.txt`:

```text
# One proxy per line
http://127.0.0.1:8080
http://user:pass@proxy.example.com:3128
```

## Library Usage

```ts
import { checkProxy, checkProxies } from "proxy-scout";

const result = await checkProxy("http://127.0.0.1:8080", {
  target: "https://api.ipify.org?format=json",
  timeoutMs: 8000,
});

console.log(result);
```

Check many proxies:

```ts
import { checkProxies } from "proxy-scout";

const results = await checkProxies(
  ["http://proxy1:8080", "http://proxy2:8080"],
  { concurrency: 10, timeoutMs: 10000 }
);

const healthy = results.filter((r) => r.ok);
console.log(healthy);
```

## Result Shape

```ts
interface CheckResult {
  proxy: string;
  ok: boolean;
  protocol: "http" | "https";
  latencyMs?: number;
  statusCode?: number;
  exitIp?: string;
  error?: string;
  target: string;
  checkedAt: string;
}
```

## Responsible Use

Use `proxy-scout` only with proxies you own, operate, or have explicit permission to test. Respect target website terms, rate limits, and applicable laws. This tool is intended for legitimate infrastructure validation, QA, and ethical web-scraping workflows.

## Development

```bash
npm install
npm run check
npm run build
```

Project structure:

```text
src/
  checker.ts   # Proxy parsing and health-check logic
  cli.ts       # CLI entry point
  index.ts     # Library exports
  types.ts     # Shared types
```

## Roadmap

- [ ] SOCKS5 proxy support
- [ ] Anonymity level detection
- [ ] CSV output
- [ ] Optional retries and backoff
- [ ] Docker image

## License

[MIT](./LICENSE) © Khadim Hussain
