/**
 * The crawlers robots.txt names, one list for both hosts: src/app/robots.ts
 * allows them the marketing site, and src/proxy.ts refuses them the whole of
 * the dashboard's own host (8 Oct 2026). A plain module so the proxy does not
 * import a metadata route file.
 */
export const ROBOTS_AGENTS: readonly string[] = [
  "*",
  "Googlebot",
  "Bingbot",
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "PerplexityBot",
  "anthropic-ai",
];
