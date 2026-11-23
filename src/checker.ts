import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { URL } from "node:url";
import type { CheckOptions, CheckResult, ProxyInput } from "./types.js";

const DEFAULT_TARGET = "https://api.ipify.org?format=json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_UA = "proxy-scout/0.1.0 (+https://github.com/khadim123/proxy-scout)";

export function parseProxy(input: string): ProxyInput {
  const raw = input.trim();
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
  }
  if (!url.hostname) {
    throw new Error(`Invalid proxy host: ${input}`);
  }

  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid proxy port: ${input}`);
  }

  return {
    host: url.hostname,
    port,
    protocol: url.protocol === "https:" ? "https" : "http",
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    original: raw,
  };
}

export function formatProxy(proxy: ProxyInput): string {
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? "")}@`
    : "";
  return `${proxy.protocol ?? "http"}://${auth}${proxy.host}:${proxy.port}`;
}

export async function checkProxy(
  input: string | ProxyInput,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const proxy = typeof input === "string" ? parseProxy(input) : input;
  const target = options.target ?? DEFAULT_TARGET;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_UA;
  const checkedAt = new Date().toISOString();
  const proxyLabel = formatProxy(proxy);

  const started = Date.now();
  try {
    const response = await requestThroughProxy(proxy, target, timeoutMs, userAgent);
    const latencyMs = Date.now() - started;
    const exitIp = extractIp(response.body);
    const ok = response.statusCode >= 200 && response.statusCode < 400;

    return {
      proxy: proxyLabel,
      ok,
      protocol: proxy.protocol ?? "http",
      latencyMs,
      statusCode: response.statusCode,
      exitIp,
      target,
      checkedAt,
      ...(ok ? {} : { error: `Unexpected status code: ${response.statusCode}` }),
    };
  } catch (err) {
    return {
      proxy: proxyLabel,
      ok: false,
      protocol: proxy.protocol ?? "http",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      target,
      checkedAt,
    };
  }
}

export async function checkProxies(
  inputs: Array<string | ProxyInput>,
  options: CheckOptions & { concurrency?: number } = {},
): Promise<CheckResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const results: CheckResult[] = new Array(inputs.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < inputs.length) {
      const current = index++;
      results[current] = await checkProxy(inputs[current], options);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface ProxyResponse {
  statusCode: number;
  body: string;
}

function requestThroughProxy(
  proxy: ProxyInput,
  target: string,
  timeoutMs: number,
  userAgent: string,
): Promise<ProxyResponse> {
  const targetUrl = new URL(target);
  if (targetUrl.protocol === "https:") {
    return requestHttpsThroughProxy(proxy, targetUrl, timeoutMs, userAgent);
  }
  if (targetUrl.protocol === "http:") {
    return requestHttpThroughProxy(proxy, targetUrl, timeoutMs, userAgent);
  }
  throw new Error(`Unsupported target protocol: ${targetUrl.protocol}`);
}

function proxyAuthHeader(proxy: ProxyInput): string | undefined {
  if (!proxy.username) return undefined;
  const token = Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64");
  return `Basic ${token}`;
}

function requestHttpThroughProxy(
  proxy: ProxyInput,
  targetUrl: URL,
  timeoutMs: number,
  userAgent: string,
): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const auth = proxyAuthHeader(proxy);
    const req = http.request(
      {
        host: proxy.host,
        port: proxy.port,
        method: "GET",
        path: targetUrl.toString(),
        headers: {
          Host: targetUrl.host,
          "User-Agent": userAgent,
          Accept: "application/json, text/plain, */*",
          ...(auth ? { "Proxy-Authorization": auth } : {}),
        },
      },
      (res) => collectResponse(res, resolve, reject),
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
    req.end();
  });
}

function requestHttpsThroughProxy(
  proxy: ProxyInput,
  targetUrl: URL,
  timeoutMs: number,
  userAgent: string,
): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const auth = proxyAuthHeader(proxy);
    const connectReq = http.request({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: `${targetUrl.hostname}:${targetUrl.port || "443"}`,
      headers: {
        Host: `${targetUrl.hostname}:${targetUrl.port || "443"}`,
        ...(auth ? { "Proxy-Authorization": auth } : {}),
      },
    });

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    connectReq.setTimeout(timeoutMs, () => {
      connectReq.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });

    connectReq.on("error", fail);
    connectReq.on("connect", (res, socket) => {
      if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
        socket.destroy();
        fail(new Error(`Proxy CONNECT failed with status ${res.statusCode}`));
        return;
      }

      const tlsSocket = tls.connect({
        socket,
        servername: targetUrl.hostname,
      });

      tlsSocket.setTimeout(timeoutMs, () => {
        tlsSocket.destroy(new Error(`Timeout after ${timeoutMs}ms`));
      });

      tlsSocket.on("error", fail);
      tlsSocket.on("secureConnect", () => {
        const payload =
          `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n` +
          `Host: ${targetUrl.host}\r\n` +
          `User-Agent: ${userAgent}\r\n` +
          `Accept: application/json, text/plain, */*\r\n` +
          `Connection: close\r\n\r\n`;

        tlsSocket.write(payload);
        let data = "";
        tlsSocket.on("data", (chunk) => {
          data += chunk.toString("utf8");
        });
        tlsSocket.on("end", () => {
          if (settled) return;
          settled = true;
          try {
            resolve(parseHttpResponse(data));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });
    });

    connectReq.end();
  });
}

function collectResponse(
  res: http.IncomingMessage,
  resolve: (value: ProxyResponse) => void,
  reject: (reason: Error) => void,
): void {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => {
    body += chunk;
  });
  res.on("end", () => {
    resolve({ statusCode: res.statusCode ?? 0, body });
  });
  res.on("error", reject);
}

function parseHttpResponse(raw: string): ProxyResponse {
  const separator = raw.indexOf("\r\n\r\n");
  if (separator === -1) {
    throw new Error("Invalid HTTP response from proxy tunnel");
  }
  const head = raw.slice(0, separator);
  const body = raw.slice(separator + 4);
  const statusLine = head.split("\r\n")[0] ?? "";
  const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/);
  if (!match) {
    throw new Error(`Invalid HTTP status line: ${statusLine}`);
  }
  return { statusCode: Number(match[1]), body };
}

function extractIp(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { ip?: string; origin?: string };
    if (typeof parsed.ip === "string") return parsed.ip;
    if (typeof parsed.origin === "string") return parsed.origin;
  } catch {
    // ignore non-JSON bodies
  }
  const match = body.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  return match?.[0];
}
