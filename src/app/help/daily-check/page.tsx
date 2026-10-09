import type { Metadata } from "next";

import HelpArticlePage from "@/components/HelpShell";
import { helpMetadata } from "@/config/help";

/** A help article (MK-2, 9 Oct 2026). Its copy is config/help.ts, slug "daily-check". */
export const metadata: Metadata = helpMetadata("daily-check");

export default function Page() {
  return <HelpArticlePage slug="daily-check" />;
}
