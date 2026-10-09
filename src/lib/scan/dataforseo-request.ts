/**
 * The pure half of the DataForSEO client: what we ask for, how long we allow
 * it, and how we read a task back. No credentials and no network, so Node's
 * own runner can execute it.
 *
 * It was split out of `dataforseo.ts` on 20 September 2026 for exactly that
 * reason. That file is `server-only` and the module this tree spends the most
 * money through, and it was one of the source files no test named - a test
 * written in place would have had to retype every request body to compare
 * against, which is how this repo's four blind tripwires were built. What is
 * here is the half a test can run; `dataforseo.ts` keeps `auth()`, `post()`
 * and the two exported reads.
 *
 * **It is not the only module that spends**, and this comment said it was
 * until later the same day. `anthropic.ts` bills per model call, and Resend
 * bills per message through `verify-email.ts` and the two public forms. That
 * wrong premise is not harmless prose: it is the one that left
 * `/api/scan/[token]/resend` outside both of the sweeps whose job is to hold
 * every door onto a vendor bill. `src/app/api/spenders.mts` carries the
 * measured set.
 *
 * Imports are relative and carry the extension deliberately. Node strips types
 * but does not resolve `@/` or an extensionless specifier, and tidying either
 * back is what makes this module untestable again.
 */

import { MARKETS, type Market } from "./domain.ts";
import type { Engine } from "./engines.ts";

/** ISO country codes for the markets we support, for the LLM Responses engines. */
export const MARKET_ISO: Record<Market, string> = { UK: "GB", US: "US" };

/** The model each LLM Responses engine is asked. Sonnet, not Opus: same answer, less spend. */
export const RESPONSE_MODELS = {
  perplexity: "sonar",
  claude: "claude-sonnet-5",
} as const;

/**
 * How deep the Google SERP is read.
 *
 * Named because five doc comments across four files describe the rank this
 * produces as "the top twenty", and until now every one of them was a number
 * typed in prose next to a number typed in a request body, with nothing
 * connecting the two. Change the request and the descriptions keep their old
 * value; that is this repo's own defect species and `request-shape.test.mts`
 * now fails when they disagree.
 *
 * The organic results come back on the same response as the Overview, so the
 * depth costs nothing extra.
 */
export const SERP_DEPTH = 20;

/**
 * Per-answer output ceiling on the LLM Responses endpoints, which bill per
 * token. An unbounded answer is an unbounded bill.
 */
export const MAX_OUTPUT_TOKENS = 1200;

/** The floor `budgetFor` will not go below, so a spent budget still tries once. */
export const MIN_BUDGET_MS = 5_000;

export type EngineRequest = { path: string; body: unknown; timeoutMs: number };

/**
 * Per-engine request shape. The two families differ: the scrapers take a
 * keyword and a location code, the LLM Responses endpoints take a prompt and,
 * where supported, a country ISO code.
 *
 * The scrapers document execution times of up to 120 seconds, so their timeout
 * is generous; the whole run is bounded separately by the pipeline.
 */
export function requestFor(engine: Engine, question: string, market: Market): EngineRequest {
  switch (engine) {
    case "google_aio":
      return {
        path: "/v3/serp/google/organic/live/advanced",
        timeoutMs: 60_000,
        body: [
          {
            keyword: question,
            location_code: MARKETS[market].location_code,
            language_code: "en",
            device: "desktop",
            depth: SERP_DEPTH,
            load_async_ai_overview: true,
          },
        ],
      };

    case "chatgpt":
      return {
        path: "/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced",
        timeoutMs: 130_000,
        body: [
          {
            keyword: question,
            location_code: MARKETS[market].location_code,
            language_code: "en",
            // Without this the model answers from memory and cites nothing,
            // which is not the question we are asking.
            force_web_search: true,
          },
        ],
      };

    case "gemini":
      return {
        path: "/v3/ai_optimization/gemini/llm_scraper/live/advanced",
        timeoutMs: 130_000,
        body: [
          {
            keyword: question,
            location_code: MARKETS[market].location_code,
            language_code: "en",
          },
        ],
      };

    case "perplexity":
      return {
        path: "/v3/ai_optimization/perplexity/llm_responses/live",
        timeoutMs: 130_000,
        body: [
          {
            user_prompt: question,
            model_name: RESPONSE_MODELS.perplexity,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            temperature: 0.2,
            web_search_country_iso_code: MARKET_ISO[market],
          },
        ],
      };

    case "claude":
      return {
        path: "/v3/ai_optimization/claude/llm_responses/live",
        timeoutMs: 130_000,
        body: [
          {
            user_prompt: question,
            model_name: RESPONSE_MODELS.claude,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            web_search: true,
            /**
             * The same market parameter Perplexity takes, on the same endpoint
             * family. It was absent, which made Claude the one engine of the
             * five whose request carried nothing derived from the market: a UK
             * scan asked it a question with no country at all, and a "who are
             * the best suppliers" answer with no country is a different answer.
             *
             * It has never shipped a wrong reading, because `GATED_ENGINES` is
             * empty and `FREE_ENGINES` leaves Claude out, so nothing has run
             * this branch on a live scan. It would have on the first run after
             * anyone put Claude in either list from `app_settings`, which is a
             * jsonb edit and no deploy.
             */
            web_search_country_iso_code: MARKET_ISO[market],
          },
        ],
      };
  }
}

/**
 * One Google organic read for a derived head keyword (R40, Danny, 27 Sep 2026),
 * to find where the scan's domain ranks for it. Separate from the google_aio
 * read, which ranks the domain for the question text and stays as it is.
 *
 * Same endpoint and depth as that read, without the Overview: nothing here
 * reads one, and asking for it only slows the task. Not wired to a caller
 * until the R41 columns are applied - see target-keyword.ts.
 */
export function keywordRankRequest(keyword: string, market: Market): EngineRequest {
  return {
    path: "/v3/serp/google/organic/live/advanced",
    timeoutMs: 60_000,
    body: [
      {
        keyword,
        location_code: MARKETS[market].location_code,
        language_code: "en",
        device: "desktop",
        depth: SERP_DEPTH,
      },
    ],
  };
}

/**
 * The shorter of what this engine needs and what the run has left, floored so a
 * budget that has already run out still makes one honest attempt rather than
 * aborting on a zero and recording an error nobody can read.
 *
 * The `Number.isFinite` guard is not decoration. `remainingMs` arrives as
 * `deadline - Date.now()`, and `typeof NaN === "number"` is true - so a NaN
 * reached `Math.min`, survived `Math.max`, and was handed to
 * `AbortSignal.timeout`, which coerces it to 0 and aborts the read before the
 * request is sent. Every engine read for the rest of the pass would have
 * failed instantly with a TimeoutError, on a scan already marked running and
 * already billed for whatever went out before it.
 */
export function budgetFor(timeoutMs: number, remainingMs: number | undefined): number {
  if (!Number.isFinite(remainingMs as number)) return timeoutMs;
  return Math.max(MIN_BUDGET_MS, Math.min(timeoutMs, remainingMs as number));
}

export type Task = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: Array<Record<string, unknown>> | null;
  /** Set by `firstTask` on a 40106 it accepted: some pages did not come back. */
  partial?: boolean;
};

/** DataForSEO's "everything is fine" task status. Anything else is an error, bar 40106 below. */
export const TASK_OK = 20000;

/**
 * Two task codes read differently from the rest (R137, Danny, 30 Sep 2026,
 * after 142 of 342 google_aio reads in 14 days errored: 115 x 40101, 27 x
 * 40106, both since 16 Sep). DataForSEO's errors appendix, read 30 Sep:
 *
 * 40101 "internal se server error. - the requested search engine was unable
 * to process your request and responded with an error". Google's side, not
 * ours: retried, twice, on the tracking runner's delays (`readRetryDelay`).
 *
 * 40106 "Task completed with partial results. Some pages could not be
 * retrieved after several retry attempts. You have not been charged for the
 * pages that were not returned. - the task has been completed successfully,
 * but we could not parse some of the requested results ... you will get 80
 * results with this error". So a 40106 with items is a read: used, and
 * marked partial. One with no items is still a failure.
 */
export const TASK_SE_ERROR = 40101;
export const TASK_PARTIAL = 40106;

/**
 * Two account-level codes that come back with no task at all (9 Oct 2026,
 * DataForSEO's errors appendix read that day): 40202 "the rate-limit per
 * minute has been exceeded" and 40209 "too many simultaneous queries" - "the
 * limit for simultaneous requests made by a single user is 30". Both say
 * "not now" about the account, not about the request, so a read that met
 * one is retried on the runner's delays like 40101.
 */
export const TASK_RATE_LIMIT = 40202;
export const TASK_TOO_MANY = 40209;

/**
 * The first task, or a throw. The error carries the task's status code and
 * what it billed (30 Sep 2026): a task DataForSEO failed can still have been
 * paid for, and the tracking runner retries on the code and records the cost
 * rather than a zero. The message is unchanged, so the scan's stored errors
 * read as they always have.
 */
export function firstTask(body: Record<string, unknown>): Task {
  const tasks = body.tasks;
  const task = (Array.isArray(tasks) ? (tasks as Task[]) : [])[0];
  if (!task) {
    // DataForSEO refused the whole request, and says why at the top level. Until 9 Oct 2026 this
    // threw that reason away: 23 of 25 ChatGPT reads that day failed as "returned no task", with
    // nothing to tell a rate limit from an outage. The code rides on the error, so retries can read it.
    const code = typeof body.status_code === "number" ? body.status_code : null;
    const said = typeof body.status_message === "string" ? body.status_message.slice(0, 60) : "";
    const err = new Error(code === null ? "DataForSEO returned no task" : `DataForSEO returned no task (${code}${said ? ` ${said}` : ""})`);
    if (code !== null) Object.assign(err, { taskStatus: code });
    throw err;
  }
  if (task.status_code === TASK_PARTIAL) {
    const items = task.result?.[0]?.items;
    if (Array.isArray(items) && items.length > 0) return { ...task, partial: true };
  }
  if (task.status_code !== TASK_OK) {
    const err = new Error(`DataForSEO task ${task.status_code}: ${task.status_message ?? "unknown"}`);
    Object.assign(err, { taskStatus: task.status_code, cost: taskCost(task) });
    throw err;
  }
  return task;
}

/**
 * What the task billed. A missing or non-numeric cost is zero, and so is a
 * negative one - a cost that moves the run's spend total downwards is the one
 * shape that can talk the daily cap into allowing a scan it should refuse.
 */
export function taskCost(task: Task): number {
  const c = task.cost;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? c : 0;
}

/**
 * `volumeKey` and `collectVolumes` were here and came out on 20 September 2026
 * with the search volume step - see `dataforseo.ts` for why.
 *
 * They were the only readers of the `keywords_search_volume` response shape.
 * What they got right is recorded here rather than in the commit, because it is
 * the kind of thing that gets re-derived if the endpoint ever comes back:
 * DataForSEO lowercases every keyword it echoes, our questions are only
 * lowercase by convention, and the map was keyed on their string and read with
 * ours - so any question carrying a capital looked up nothing and stored a null
 * volume, which is indistinguishable from a question that genuinely has none.
 */

/**
 * Search volume came back on 27 September 2026 (Danny, R38/R39), narrower:
 * Google Ads volume for the derived head keywords, never the question text,
 * in one batched call per scan. `request-shape.test.mts` holds this path to
 * this file and the old AI-keyword endpoint to nowhere.
 *
 * Not wired to a caller until the R41 columns are applied.
 */
export const KEYWORD_VOLUME_PATH = "/v3/keywords_data/google_ads/search_volume/live";

/** The endpoint's own per-task keyword ceiling. */
export const KEYWORD_VOLUME_MAX = 1000;

/** Lowercased and trimmed: the form DataForSEO echoes a keyword back in. */
export function keywordForm(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, " ");
}

export function keywordVolumeRequest(keywords: readonly string[], market: Market): EngineRequest {
  const unique = [...new Set(keywords.map(keywordForm).filter(Boolean))];
  if (unique.length > KEYWORD_VOLUME_MAX) throw new Error(`${unique.length} keywords is over the ${KEYWORD_VOLUME_MAX} one task takes`);
  return {
    path: KEYWORD_VOLUME_PATH,
    timeoutMs: 60_000,
    body: [{ keywords: unique, location_code: MARKETS[market].location_code, language_code: "en" }],
  };
}

/**
 * Keyword -> monthly searches, keyed and read in `keywordForm` on both sides
 * so a capital cannot miss (the defect recorded above). A keyword the task
 * returned without a number maps to null, which is "not measured", not zero.
 */
export function keywordVolumes(task: Task): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const row of task.result ?? []) {
    if (typeof row.keyword !== "string") continue;
    const v = row.search_volume;
    out.set(keywordForm(row.keyword), typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  }
  return out;
}

/**
 * The cluster keyword's intent - C1 of
 * docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md (Danny, 29 Sep 2026,
 * decision 3). DataForSEO Labs' search intent read takes keywords and a
 * language and no location. Only the primary `keyword_intent.label` is read;
 * secondary intents are ignored. Documented example cost $0.0014 for 4
 * keywords - to be measured on the first real scan (docs/scan-setup.md).
 *
 * Built and parsed here, sent from `readKeywordIntents` in `dataforseo.ts`,
 * and not yet called: C1's route change wires it.
 */
export const KEYWORD_INTENT_PATH = "/v3/dataforseo_labs/google/search_intent/live";

/** The endpoint's own per-task keyword ceiling. */
export const KEYWORD_INTENT_MAX = 1000;

export const INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;
export type Intent = (typeof INTENTS)[number];

export function keywordIntentRequest(keywords: readonly string[]): EngineRequest {
  const unique = [...new Set(keywords.map(keywordForm).filter(Boolean))];
  if (unique.length > KEYWORD_INTENT_MAX) throw new Error(`${unique.length} keywords is over the ${KEYWORD_INTENT_MAX} one task takes`);
  return { path: KEYWORD_INTENT_PATH, timeoutMs: 30_000, body: [{ keywords: unique, language_code: "en" }] };
}

/**
 * Keyword -> primary intent, keyed in `keywordForm`. The task's result is one
 * row holding `items`, each `{ keyword, keyword_intent: { label, probability } }`.
 * A label outside the four is null (not read), never a guess.
 */
export function keywordIntents(task: Task): Map<string, Intent | null> {
  const out = new Map<string, Intent | null>();
  for (const row of task.result ?? []) {
    const items = (row as { items?: unknown }).items;
    for (const item of Array.isArray(items) ? (items as Record<string, unknown>[]) : []) {
      if (typeof item.keyword !== "string") continue;
      const label = (item.keyword_intent as { label?: unknown } | null | undefined)?.label;
      out.set(keywordForm(item.keyword), (INTENTS as readonly string[]).includes(String(label)) ? (label as Intent) : null);
    }
  }
  return out;
}
