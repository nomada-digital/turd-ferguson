import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Cited from "@/components/app/Cited";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { clusterSearch } from "@/lib/tracking/cluster-figures";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Cited pages - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/** `?open=` is a page as citedPageRows writes it: a host, then a path. Anything else opens none. */
const openPage = (raw: string | null) => (raw && raw.length <= 300 && /^[a-z0-9.-]+\.[a-z0-9-]+(\/\S*)?$/.test(raw) ? raw : null);

/**
 * One client's Cited pages (R144, BRIEF-4 P4: appPath(`/[client]/cited`)), for the
 * range the URL states. Same membership rule as the overview. `?cluster=`
 * must be one of this client's clusters, `?engine=` one of its tier's
 * engines and `?kind=` yours or others; anything else is All.
 */
export default async function ClientCited({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/cited`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today);
  const [data, upgrade, placements] = await Promise.all([repo.loadOverview(client.id, range, compare), repo.upgradeContext(client.id, email, today), repo.placements(client.id)]);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const cluster = (data.clusters ?? []).some((c) => c.id === one("cluster")) ? one("cluster") : null;
  const engine = engines.find((e) => e === one("engine")) ?? null;
  const k = one("kind");

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} current="Cited pages" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Cited
          domain={client.domain}
          engines={engines}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          data={data}
          placements={placements}
          slug={slug}
          cluster={cluster}
          engine={engine}
          kind={k === "yours" || k === "others" ? k : "all"}
          all={one("all") === "1"}
          open={openPage(one("open"))}
          q={clusterSearch(one("q"))}
        />
      </div>
    </div>
  );
}
