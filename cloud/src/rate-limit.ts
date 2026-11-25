import type { IncomingMessage } from "node:http";

export interface RateLimitPolicy {
  name: string;
  scope: "ip" | "user";
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  windowSeconds: number;
}

export interface RateLimiter {
  check(key: string, policy: RateLimitPolicy): RateLimitDecision;
}

export const RATE_LIMIT_POLICIES = {
  auth: { name: "auth", scope: "ip", limit: 20, windowMs: 15 * 60 * 1000 },
  oauth: { name: "oauth", scope: "user", limit: 10, windowMs: 10 * 60 * 1000 },
  general: { name: "general", scope: "ip", limit: 300, windowMs: 60 * 1000 },
  ai: { name: "ai", scope: "user", limit: 30, windowMs: 60 * 1000 },
  heavy: { name: "heavy", scope: "user", limit: 20, windowMs: 60 * 1000 },
} as const satisfies Record<string, RateLimitPolicy>;

interface WindowRecord {
  start: number;
  count: number;
}

/** Fixed-window limiter with lazy cleanup and a hard key cap to bound memory use. */
export function createFixedWindowRateLimiter(options: {
  now?: () => number;
  maxKeys?: number;
} = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 50_000;
  const windows = new Map<string, WindowRecord>();

  return {
    check(key, policy) {
      const current = now();
      const start = Math.floor(current / policy.windowMs) * policy.windowMs;
      const record = windows.get(key);
      if (!record || record.start !== start) {
        windows.set(key, { start, count: 0 });
      }
      const entry = windows.get(key)!;
      const allowed = entry.count < policy.limit;
      if (allowed) entry.count += 1;
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(1, Math.ceil((entry.start + policy.windowMs - current) / 1000));

      if (windows.size > maxKeys) {
        for (const [candidate, value] of windows) {
          if (value.start + policy.windowMs <= current) windows.delete(candidate);
        }
        while (windows.size > maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
      }
      return {
        allowed,
        limit: policy.limit,
        remaining: allowed ? Math.max(0, policy.limit - entry.count) : 0,
        retryAfterSeconds,
        windowSeconds: Math.ceil(policy.windowMs / 1000),
      };
    },
  };
}

/** Only trust proxy headers when an explicit reverse proxy is configured. */
export function clientIpFromRequest(req: IncomingMessage, trustProxy = false): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = String(raw || "").split(",")[0]?.trim();
    if (first && first.length <= 200 && /^[A-Za-z0-9._:\-]+$/.test(first)) return first;
  }
  return String(req.socket?.remoteAddress || "unknown").slice(0, 200);
}

export function selectRateLimitPolicy(path: string, method: string): RateLimitPolicy {
  if (path === "/api/auth/register" || path === "/api/auth/login") return RATE_LIMIT_POLICIES.auth;
  if (path === "/api/github/oauth/start") return RATE_LIMIT_POLICIES.oauth;
  if (
    path === "/api/chat" ||
    path === "/api/search" ||
    path === "/api/projects/ai-files" ||
    /^\/api\/images\/[^/]+\/analyze$/.test(path)
  ) {
    return RATE_LIMIT_POLICIES.ai;
  }
  if (
    (path === "/api/images" || path === "/api/tasks" || path === "/api/images/generate") &&
    method === "POST"
  ) {
    return RATE_LIMIT_POLICIES.heavy;
  }
  return RATE_LIMIT_POLICIES.general;
}
