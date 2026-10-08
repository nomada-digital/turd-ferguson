import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Overview from "@/components/app/Overview";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { CARD, T } from "@/config/tokens";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { needsSetup, setupOutstanding, setupPath } from "@/lib/tracking/setup-landing";
import { refuseRole } from "@/lib/tracking/stop";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's dashboard: the sidebar (T3, 29 Sep 2026) and the overview
 * (T4), for the range the URL states - `?from=&to=&compare=`, BRIEF
 * decision 3.
 *
 * A slug the session's email is not a member of is a 404, not a 403, so
 * client slugs are not discoverable.
 */
export default async function ClientDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  const placed = placedTier(tier);
  const [data, upgrade, rows, confirmed] = await Promise.all([repo.loadOverview(client.id, range, compare), repo.upgradeContext(client.id, email, today), repo.placements(client.id), needsSetup(client) || fixtureMode() ? repo.setupConfirmed(client.id) : null]);
  // DS10: a member who left setup before confirming gets back to it from here. Only a client that needs setup pays the read.
  const outstanding = setupOutstanding(client, confirmed, fixtureMode());
  // R173 pass 2 (pass 1's P3): the confirm route's 303 lands here; it is said only when the confirm reads back.
  const justConfirmed = sp.setup === "confirmed" && confirmed === true;
  const canWrite = refuseRole(writeRole(client)) === null;
  // R97 part 5: "Show placements" on the same rule as the placements screen - a placed tier, or any placement logged.
  const placements = placed || rows.some((p) => p.status !== "removed") ? rows : undefined;

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} placements={placed} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        {outstanding ? (
          <div style={{ ...CARD, borderRadius: "14px", padding: "14px 18px", marginBottom: "24px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px" }}>
            <p style={{ margin: 0, flex: "1 1 260px", fontSize: "15px", lineHeight: 1.6 }}>
              Your setup is not confirmed yet.{canWrite ? " Check your clusters and confirm them." : " An owner or editor confirms it."}
            </p>
            <a href={setupPath(slug)} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", color: T.accent, fontWeight: 600 }}>
              {canWrite ? "Finish setup" : "See setup"}
            </a>
          </div>
        ) : null}
        {justConfirmed ? (
          <p role="status" style={{ margin: "0 0 24px", padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, width: "fit-content", maxWidth: "100%", boxSizing: "border-box" }}>
            Setup confirmed.
          </p>
        ) : null}
        <Overview
          brand={client.brand ?? client.domain}
          domain={client.domain}
          market={client.market}
          engines={engines}
          startedOn={client.started_on}
          today={today}
          range={range}
          compareMode={compare}
          data={data}
          selected={typeof sp.cluster === "string" ? sp.cluster : undefined}
          clustersPath={appPath(`/${slug}/clusters`)}
          reportPath={`/api/app/${encodeURIComponent(slug)}/report`}
          clusterLimit={client.cluster_limit ?? CLUSTER_BASE}
          placements={placements}
          canWrite={canWrite}
          ended={client.status === "ended"}
        />
      </div>
    </div>
  );
}
