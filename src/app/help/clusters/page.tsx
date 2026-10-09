import type { Metadata } from "next";

import HelpArticlePage from "@/components/HelpShell";
import { helpMetadata } from "@/config/help";

/** A help article (MK-2, 9 Oct 2026). Its copy is config/help.ts, slug "clusters". */
export const metadata: Metadata = helpMetadata("clusters");

export default function Page() {
  return <HelpArticlePage slug="clusters" />;
}
