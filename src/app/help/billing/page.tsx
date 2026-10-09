import type { Metadata } from "next";

import HelpArticlePage from "@/components/HelpShell";
import { helpMetadata } from "@/config/help";

/** A help article (MK-2, 9 Oct 2026). Its copy is config/help.ts, slug "billing". */
export const metadata: Metadata = helpMetadata("billing");

export default function Page() {
  return <HelpArticlePage slug="billing" />;
}
