import type { JiraTicket } from "./types.js";

export interface JiraConfigInternal {
  baseUrl: string;
  email: string;
  apiToken: string;
}

interface RawIssue {
  key: string;
  fields: { summary: string; status: { name: string }; assignee: { displayName: string } | null; updated: string };
}

function authHeader(cfg: JiraConfigInternal): string {
  return "Basic " + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Jira Cloud's /search endpoints don't reliably 401 on a bad token — they've been observed
 * to silently downgrade to an ANONYMOUS request and return 200 with an empty result, which
 * would otherwise look exactly like "the query just has no matches". /myself is a cheap
 * endpoint that DOES 401 correctly, so it's used as an explicit credential check first.
 */
async function verifyAuth(cfg: JiraConfigInternal): Promise<void> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const res = await fetchWithTimeout(`${base}/rest/api/3/myself`, {
    headers: { Authorization: authHeader(cfg), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira-Anmeldung fehlgeschlagen: ${res.status} ${await safeText(res)}`);
}

/**
 * Jira Cloud is phasing out the classic GET /search endpoint in favour of the token-paged
 * POST /search/jql. Try classic first (one request, no paging needed for a personal
 * dashboard's result sizes) and fall back only if it's actually gone.
 */
async function searchIssues(cfg: JiraConfigInternal, jql: string): Promise<RawIssue[]> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const headers = { Authorization: authHeader(cfg), Accept: "application/json" };
  const fields = "summary,status,assignee,updated";

  const classicUrl = `${base}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100`;
  const classic = await fetchWithTimeout(classicUrl, { headers });
  if (classic.ok) return ((await classic.json()) as { issues: RawIssue[] }).issues;
  if (classic.status !== 404 && classic.status !== 410) {
    throw new Error(`Jira-Suche fehlgeschlagen: ${classic.status} ${await safeText(classic)}`);
  }

  const res = await fetchWithTimeout(`${base}/rest/api/3/search/jql`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ jql, fields: fields.split(","), maxResults: 100 }),
  });
  if (!res.ok) throw new Error(`Jira-Suche fehlgeschlagen: ${res.status} ${await safeText(res)}`);
  return ((await res.json()) as { issues: RawIssue[] }).issues;
}

/** Runs the given JQL and maps to the flat shape the QA-tickets panel renders. Empty
 *  config or an empty JQL returns [] rather than querying Jira with nothing to ask.
 *  Network/auth failures throw — the caller (server.ts) turns that into a surfaced
 *  "not configured" / "auth failed" status rather than silently showing an empty list. */
export async function fetchTickets(cfg: JiraConfigInternal, jql: string): Promise<JiraTicket[]> {
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken || !jql.trim()) return [];
  await verifyAuth(cfg);
  const issues = await searchIssues(cfg, jql);
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    assignee: issue.fields.assignee?.displayName ?? null,
    url: `${base}/browse/${issue.key}`,
    updatedAt: new Date(issue.fields.updated).getTime(),
  }));
}
