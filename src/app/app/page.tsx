import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { appPath } from "@/lib/app-host";
import { trackingRepo } from "@/lib/tracking/repo";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/** /app sends a member to their first client, and anyone else to the login page. */
export default async function AppHome() {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(appPath("/login"));
  const clients = await repo.clientsFor(email);
  if (!clients.length) redirect(appPath("/login?access=none"));
  redirect(appPath(`/${clients[0]!.slug}`));
}
