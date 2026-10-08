import "server-only";

import { enginesFor } from "@/config/pricing";
import type { TierKey } from "@/components/TierName";

import { clusterChart } from "./cluster-figures.ts";
import { type Day, type Range, addDays } from "./figures.ts";
import { rangeFrom } from "./overview-data.ts";
import { type PlacementsView, chartSeries, citeRows, pickCluster, placedTier, placementsView } from "./placement-figures.ts";
import type { TrackingRepo } from "./repo.ts";

/** The longest "since it started" the screen reads in one go. */
const SINCE_MAX_DAYS = 364;

export type PlacementsScreen = {
  range: Range;
  /** True when the URL stated the range; otherwise it is since the client started. */
  stated: boolean;
  clusters: { id: string; name: string; keyword_id: string | null; started_on: Day; stopped_on: Day | null }[];
  cluster: { id: string; name: string; started_on: Day };
  keyword: string | null;
  prompts: number;
  view: PlacementsView;
  /** The two panels (part 4b): weekly over 35 days, daily otherwise. */
  series: ReturnType<typeof chartSeries>;
};

/**
 * What the placements screen and its CSV read (T13, R97 parts 3-4, 30 Sep
 * 2026), in one place so the page and the download count the same rows.
 * Null when the client may not see the screen - no placed tier and no logged
 * placement - or has no cluster; both callers answer that with a 404.
 * Without from/to the range is since the client started.
 */
export async function placementsScreen(
  repo: TrackingRepo,
  client: { id: string; tier: string; started_on?: Day | null },
  sp: Record<string, string | string[] | undefined>,
  today: Day,
): Promise<PlacementsScreen | null> {
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const stated = typeof sp.from === "string" && typeof sp.to === "string";
  const floor = addDays(today, -SINCE_MAX_DAYS);
  const started: Day = client.started_on && client.started_on > floor ? client.started_on : floor;
  const range = stated ? rangeFrom(sp, today).range : { from: started > today ? today : started, to: today };
  const [structure, rows] = await Promise.all([repo.structure(client.id), repo.placements(client.id)]);
  if (!placedTier(tier) && !rows.some((p) => p.status !== "removed")) return null;

  const clusters = (structure.clusters ?? []).filter((c) => c.stopped_on === null || c.stopped_on > range.from);
  const cluster = clusters.find((c) => c.id === pickCluster(clusters, rows, typeof sp.cluster === "string" ? sp.cluster : null));
  if (!cluster) return null;
  // perf-1/perf-4 (8 Oct 2026): the picked cluster's prompts only, with their citations and no brands - all the
  // chart and the table count (read-shape.test.mts). The structure is passed on, so it is not read twice.
  const data = await repo.loadOverview(client.id, range, "none", { answers: "cites", cluster: cluster.id, structure });
  const chart = clusterChart({ clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: null, today, engines }, cluster.id);
  if (!chart) return null;
  const questionIds = data.questions.filter((q) => q.cluster_id === cluster.id && (q.stopped_on === null || q.stopped_on > range.from)).map((q) => q.id);
  return {
    range,
    stated,
    clusters,
    cluster,
    keyword: data.keywords.find((k) => k.id === cluster.keyword_id)?.keyword ?? null,
    prompts: questionIds.length,
    view: placementsView({ chart, questionIds, placements: rows.filter((p) => p.cluster_id === cluster.id), cites: citeRows(data.answers), engines }),
    series: chartSeries(chart),
  };
}
