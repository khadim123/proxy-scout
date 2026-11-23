#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { checkProxies } from "./checker.js";
import type { CheckResult } from "./types.js";

interface CliArgs {
  proxies: string[];
  file?: string;
  target?: string;
  timeoutMs: number;
  concurrency: number;
  json: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`proxy-scout - check HTTP/HTTPS proxy health

Usage:
  proxy-scout <proxy...> [options]
  proxy-scout --file proxies.txt [options]

Options:
  --file <path>         Read proxies from a file (one per line)
  --target <url>        Target URL to test through the proxy
                        (default: https://api.ipify.org?format=json)
  --timeout <ms>        Timeout per proxy in milliseconds (default: 10000)
  --concurrency <n>     Number of concurrent checks (default: 5)
  --json                Output results as JSON
  --help                Show this help message

Examples:
  proxy-scout http://127.0.0.1:8080
  proxy-scout http://user:pass@proxy.example.com:8080 --timeout 8000
  proxy-scout --file proxies.txt --concurrency 10 --json
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    proxies: [],
    timeoutMs: 10_000,
    concurrency: 5,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--file") {
      args.file = argv[++i];
      if (!args.file) throw new Error("Missing value for --file");
    } else if (arg === "--target") {
      args.target = argv[++i];
      if (!args.target) throw new Error("Missing value for --target");
    } else if (arg === "--timeout") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid --timeout value");
      args.timeoutMs = value;
    } else if (arg === "--concurrency") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) throw new Error("Invalid --concurrency value");
      args.concurrency = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      args.proxies.push(arg);
    }
  }

  return args;
}

function loadProxiesFromFile(path: string): string[] {
  const content = readFileSync(path, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function printTable(results: CheckResult[]): void {
  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL";
    const latency = r.latencyMs != null ? `${r.latencyMs}ms` : "-";
    const code = r.statusCode != null ? String(r.statusCode) : "-";
    const ip = r.exitIp ?? "-";
    const detail = r.ok ? `ip=${ip}` : `error=${r.error ?? "unknown"}`;
    console.log(`[${status}] ${r.proxy}  latency=${latency}  status=${code}  ${detail}`);
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\nSummary: ${ok}/${results.length} proxies healthy`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const fileProxies = args.file ? loadProxiesFromFile(args.file) : [];
  const proxies = [...args.proxies, ...fileProxies];

  if (proxies.length === 0) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const results = await checkProxies(proxies, {
    target: args.target,
    timeoutMs: args.timeoutMs,
    concurrency: args.concurrency,
  });

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printTable(results);
  }

  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
