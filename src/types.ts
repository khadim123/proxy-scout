export type ProxyProtocol = "http" | "https";

export interface ProxyInput {
  host: string;
  port: number;
  protocol?: ProxyProtocol;
  username?: string;
  password?: string;
  original?: string;
}

export interface CheckOptions {
  /** Target URL to request through the proxy. Defaults to https://api.ipify.org?format=json */
  target?: string;
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
  /** User-Agent header sent with the test request. */
  userAgent?: string;
}

export interface CheckResult {
  proxy: string;
  ok: boolean;
  protocol: ProxyProtocol;
  latencyMs?: number;
  statusCode?: number;
  exitIp?: string;
  error?: string;
  target: string;
  checkedAt: string;
}
