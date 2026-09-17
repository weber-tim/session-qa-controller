export type SessionSource = "cli" | "desktop";

/** where an aircraft's live `state` came from (hook = best, inferred = slow fallback) */
export type StateSource = "hook" | "registry" | "inferred";

export interface PrInfo {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  reviewDecision: string | null;
  url: string;
  title: string | null;
}

/** one listening port attributed to a strip's folder, with a best-effort description */
export interface DevPort {
  port: number;
  pid: number;
  addr: string;
  proc: string;
  role: "app" | "api" | "hmr" | "storybook" | "unknown";
  label: string;
}

/** dev servers detected listening in this strip's folder (Phase 1: detection-only) */
export interface DevServerInfo {
  /** best-guess app port — drives the pill + its URL */
  port: number;
  pid: number;
  /** every listening port in the folder, best-guess first, each described */
  candidates: DevPort[];
  managed: boolean;
  repoKey: string;
  repoName: string;
  /** per-repo dev URL template with a {port} placeholder; null = default localhost */
  urlTemplate: string | null;
}

export type ActivityState =
  | "working"
  | "needs-input"
  | "idle"
  | "dormant"
  | "suspected-done"
  | "error"
  | "unknown";

export interface Aircraft {
  id: string;
  source: SessionSource;
  surfaces?: SessionSource[];
  path: string;
  project: string | null;
  branch: string | null;
  title: string | null;
  model: string | null;
  firstSeenAt: number | null;
  lastActivityAt: number | null;
  state: ActivityState;
  stateSource?: StateSource;
  stateSince?: number | null;
  lastEventSummary: string;
  linkedCliSessionId: string | null;
  note?: string | null;
  landed?: boolean;
  contextTokens?: number | null;
  contextPct?: number | null;
  /** API-equivalent cost of this flight (its own spend plus any compaction predecessors) */
  costUsd?: number | null;
  costTokens?: CostTokens | null;
  /** ran on a model with no price entry — `costUsd` is a lower bound */
  costUnpriced?: boolean;
  pr?: PrInfo | null;
  approach?: boolean;
  devServer?: DevServerInfo | null;
  /** the repo's configured dev command (null = not set) — enables the Start button */
  devCommand?: string | null;
  /** a tower-managed dev server running for this strip's folder — enables Stop + logs */
  devManaged?: { pid: number; startedAt: number } | null;
  /** a tower-managed server that recently crashed — shows an "exited" affordance + logs */
  devExit?: { code: number | null; at: number } | null;
  /** install status for the strip's repo (null = not a git repo) — drives the Install button */
  devInstall?: { running: boolean; code: number | null; at: number } | null;
  offline?: boolean;
}

/** tokens behind a cost figure, split by how each kind is priced */
export interface CostTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** board-wide cost roll-up from the server's cost ledger */
export interface CostSummary {
  today: number;
  /** spend in the running calendar month */
  month: number;
  unpricedSessions: number;
  /** the one-off backfill over the full transcript history has finished */
  scanned: boolean;
}

export type Lane = "inflight" | "mia" | "holding" | "parked" | "cold" | "landed";

/** the board's five rendered lanes, partitioned + sorted once and shared (App + FlightBoard) */
export interface LanePartition {
  inflight: Aircraft[];
  holding: Aircraft[];
  parked: Aircraft[];
  landed: Aircraft[];
  mia: Aircraft[];
}

export interface AnthropicStatus {
  indicator: string;
  description: string;
  components: { name: string; status: string }[];
  incidents: { name: string; impact: string; status: string; url: string }[];
  url: string;
  updatedAt: string;
  fetchedAt: number;
}

export type HooksHealthStatus = "healthy" | "degraded" | "down";
export interface HooksHealth {
  status: HooksHealthStatus;
  settingsFound: boolean;
  installedEvents: string[];
  missingRequired: string[];
  freshWrites: number;
  lastWriteAt: number | null;
  activeSessions: number;
  activeCli: number;
  onFallback: number;
  detail: string;
  checkedAt: number;
}

/** a personal to-do board, laned like the session board itself */
export type TodoLane = "open" | "inflight" | "holding" | "landed";

/** a free-text to-do card — not tied to any session/aircraft. `position` orders cards
 *  within their lane (ascending). */
export interface Todo {
  id: string;
  text: string;
  lane: TodoLane;
  position: number;
  createdAt: number;
  landedAt: number | null;
  note: string | null;
  /** an http(s) link (Jira/Confluence/Slack thread/…) shown as a clickable chip */
  link: string | null;
}

/** Jira connection settings as the browser sees them — the API token itself never arrives
 *  here, only whether one is stored (see Store.getJiraConfig on the backend). `jql` is the
 *  query currently being polled — pasted freely, no project/status picker. */
export interface JiraConfig {
  baseUrl: string;
  email: string;
  hasToken: boolean;
  jql: string;
}

/** a saved JQL preset — just a name shortcut onto JiraConfig.jql */
export interface JiraView {
  id: string;
  name: string;
  jql: string;
  createdAt: number;
}

/** one row of the current JQL's results */
export interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  url: string;
  /** Jira's own `updated` field — drives the "Xd since update" display */
  updatedAt: number;
}

export interface JiraPollStatus {
  ok: boolean;
  error: string | null;
  checkedAt: number | null;
}

export type WsMessage =
  | { type: "snapshot" | "update"; ts: number; aircraft: Aircraft[] }
  | { type: "status"; ts: number; status: AnthropicStatus | null }
  | { type: "health"; ts: number; health: HooksHealth | null }
  | { type: "cost"; ts: number; cost: CostSummary }
  | {
      type: "version";
      ts: number;
      current: { build: number | null; sha: string; pretty: string };
      updateAvailable: boolean;
      latest: { build: number | null; sha: string; pretty: string } | null;
    }
  | { type: "todos"; ts: number; todos: Todo[] }
  | { type: "jira"; ts: number; tickets: JiraTicket[]; status: JiraPollStatus };
