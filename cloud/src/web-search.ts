export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  provider: string;
}

export interface WebSearchInput {
  query: string;
  limit?: number;
}

export interface WebSearchService {
  search(input: WebSearchInput): Promise<WebSearchResponse>;
}

export type WebSearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class WebSearchError extends Error {
  status: number;
  code: string;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "WebSearchError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/";
const MAX_QUERY_LENGTH = 500;

export function normalizeSearchQuery(raw: unknown): string {
  const query = String(raw || "").replace(/\s+/g, " ").trim();
  if (!query) throw new WebSearchError("invalid_search_query");
  if (query.length > MAX_QUERY_LENGTH) throw new WebSearchError("invalid_search_query");
  return query;
}

export function normalizeSearchLimit(raw: unknown): number {
  const parsed = Number(raw ?? 5);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(Math.trunc(parsed), 10));
}

export function createWebSearchService(options: {
  fetchImpl?: WebSearchFetch;
  endpoint?: string;
  stub?: boolean;
} = {}): WebSearchService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? process.env.WEB_SEARCH_ENDPOINT ?? DEFAULT_ENDPOINT;
  const stub = options.stub ?? process.env.CLOUD_WEB_SEARCH_STUB === "1";

  return {
    async search({ query: rawQuery, limit: rawLimit }) {
      const query = normalizeSearchQuery(rawQuery);
      const limit = normalizeSearchLimit(rawLimit);
      if (stub) {
        return {
          query,
          provider: "stub/local-test",
          results: Array.from({ length: Math.min(limit, 2) }, (_, index) => ({
            title: `Stub result ${index + 1} for ${query}`,
            url: `https://example.invalid/search/${index + 1}`,
            snippet: `Deterministic stub search result for "${query}".`,
          })),
        };
      }

      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      const response = await fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "CloudOpenCode/0.1 (+https://github.com/SikoroApps/Cloud-OpenCode-Builder)",
        },
      }).catch(() => null);
      if (!response || !response.ok) throw new WebSearchError("web_search_failed", 502);
      let html: string;
      try {
        html = await response.text();
      } catch {
        throw new WebSearchError("web_search_failed", 502);
      }
      return { query, provider: "duckduckgo_html", results: parseDuckDuckGoHtml(html, limit) };
    },
  };
}

export function parseDuckDuckGoHtml(html: string, limit = 5): WebSearchResult[] {
  const normalizedLimit = Math.max(1, Math.min(limit, 10));
  const titleMatches = [...html.matchAll(
    /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )];
  const snippetMatches = [...html.matchAll(
    /<(?:a|div)\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi,
  )];
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < titleMatches.length && results.length < normalizedLimit; index += 1) {
    const match = titleMatches[index];
    const title = stripHtml(match[2]);
    const url = normalizeResultUrl(decodeHtmlEntities(match[1]));
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title,
      url,
      snippet: stripHtml(snippetMatches[index]?.[1] || ""),
    });
  }
  return results;
}

export function normalizeResultUrl(raw: string): string | null {
  let candidate = decodeHtmlEntities(raw).trim();
  if (!candidate) return null;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const target = parsed.searchParams.get("uddg");
      if (target) {
        const targetUrl = new URL(target);
        if (targetUrl.protocol === "https:" || targetUrl.protocol === "http:") return targetUrl.toString();
      }
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => safeCodePoint(parseInt(decimal, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
