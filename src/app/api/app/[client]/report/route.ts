import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { rangeFrom } from "@/lib/tracking/overview-data";
import { PLACEMENTS_FOOTNOTE } from "@/lib/tracking/placement-figures";
import { placementsScreen } from "@/lib/tracking/placements-screen";
import { answersCsv, isReportKind, keywordsCsv, placementsCsv, reportFilename } from "@/lib/tracking/report-csv";
import { trackingRepo } from "@/lib/tracking/repo";
import { recordUsage } from "@/lib/tracking/usage-record";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Download report" - BRIEF-2 T8 v1 (R90, Danny, 29 Sep 2026, danny.md line
 * 84): `GET ?kind=answers|keywords&from=&to=` returns the range as a CSV
 * (report-csv.ts). It only reads. Any member of the client may download,
 * viewers included, as they can already read the same rows on the page.
 * Session and membership are checked through the page's repo, so the fixture
 * serves the fixture.
 */
export async function GET(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  if (!isReportKind(kind)) return NextResponse.json({ error: "kind is answers, keywords or placements." }, { status: 400 });

  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await repo.clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let range = rangeFrom(Object.fromEntries(sp), repo.today(), client.started_on).range;
  let body: string;
  if (kind === "placements") {
    // The placements screen's own read (placements-screen.ts), so the file is the table on the page.
    const screen = await placementsScreen(repo, client, Object.fromEntries(sp), repo.today());
    if (!screen) return NextResponse.json({ error: "Not found." }, { status: 404 });
    range = screen.range;
    body = placementsCsv(screen.view, screen.keyword ?? screen.cluster.name, PLACEMENTS_FOOTNOTE);
  } else {
    // perf-4 (8 Oct 2026): the keywords file is tracking_serp's rows, so it reads no answer.
    const data = await repo.loadOverview(client.id, range, "none", kind === "keywords" ? { answers: "none" } : {});
    body = kind === "answers" ? answersCsv(data, range) : keywordsCsv(data, range);
  }
  // T10: the download is counted (ids only); the fixture writes nothing.
  if (!fixtureMode()) await recordUsage(supabaseAdmin(), { clientId: client.id, email, event: "csv", path: kind === "placements" ? "/placements" : "/", props: { type: kind }, today: repo.today() });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${reportFilename(slug, kind, range)}"`,
      "cache-control": "private, no-store",
    },
  });
}
