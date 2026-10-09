import Link from "next/link";

import { H2, OL, P, UL } from "@/components/PostShell";
import { TierText } from "@/components/TierName";
import { HELP, HELP_INDEX, HELP_PATH, STILL_STUCK, helpArticle, helpHref, type HelpBlock } from "@/config/help";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";

/**
 * The help centre's page (MK-2, 9 Oct 2026): a post's shell - the article on
 * eight columns, the aside on four, stacking on a phone - so it adds no
 * layout and no colour of its own. `.post-shell` and the two `.post-toc-*`
 * classes are the blog's, and the body is PostShell's P, UL and OL, so the
 * help reads at the blog's measure and in its ink.
 *
 * The aside lists every help article with the open one marked, the way
 * /legal's sidebar switches between its documents, then this page's sections
 * and where to write. The motion beat is on the header rows and the aside
 * cards only, as on a post: prose arriving a paragraph at a time is the
 * sparkle globals.css declined.
 *
 * Copy is config/help.ts, plain text with two marks; `HelpText` turns
 * `[label](href)` into a link and `**label**` into the bold of a control's
 * name, and every other run of words goes through TierText, so a tier name is
 * the lockup in the body and plain in the head. A link's words stay plain:
 * no lockup sits inside a link bar the logo (result-copy.test.mts), so no
 * label, article title or heading here names a tier (help.test.mts).
 */

const MARK = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
const LINK = { color: T.accent, fontWeight: 600 } as const;

/** One run of help copy, with its links and control names. */
export function HelpText({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(MARK)) {
    const i = m.index ?? 0;
    if (i > at) out.push(<TierText key={`t${i}`}>{text.slice(at, i)}</TierText>);
    if (m[3] !== undefined) {
      out.push(
        <strong key={`b${i}`} style={{ fontWeight: 600, color: T.ink }}>
          <TierText>{m[3]}</TierText>
        </strong>,
      );
    } else {
      const [label, href] = [m[1]!, m[2]!];
      out.push(
        href.startsWith("/") ? (
          <Link key={`l${i}`} href={href} style={LINK}>
            {label}
          </Link>
        ) : (
          <a key={`l${i}`} href={href} style={LINK}>
            {label}
          </a>
        ),
      );
    }
    at = i + m[0].length;
  }
  if (at < text.length) out.push(<TierText key="end">{text.slice(at)}</TierText>);
  return <>{out}</>;
}

function Blocks({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        typeof b === "string" ? (
          <P key={i}>
            <HelpText text={b} />
          </P>
        ) : "list" in b ? (
          <UL key={i}>
            {b.list.map((item, j) => (
              <li key={j} style={{ marginTop: j ? "6px" : 0 }}>
                <HelpText text={item} />
              </li>
            ))}
          </UL>
        ) : (
          <OL key={i}>
            {b.steps.map((item, j) => (
              <li key={j} style={{ marginTop: j ? "6px" : 0 }}>
                <HelpText text={item} />
              </li>
            ))}
          </OL>
        ),
      )}
    </>
  );
}

/** Every help article, the open one marked rather than linked. */
function Articles({ current }: { current: string | null }) {
  return (
    <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
      {HELP.map((a) => (
        <li key={a.slug}>
          {a.slug === current ? (
            <span
              aria-current="page"
              style={{ display: "block", padding: "8px 11px", borderRadius: "8px", background: T.chip, border: `1px solid ${T.line}`, fontSize: "14px", fontWeight: 600, color: T.ink }}
            >
              <TierText>{a.title}</TierText>
            </span>
          ) : (
            <Link href={helpHref(a.slug)} style={{ display: "block", padding: "8px 11px", fontSize: "14px", textDecoration: "none", color: T.soft }}>
              {a.title}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function Contents({ sections, gap = "10px", margin = "12px 0 0" }: { sections: { id: string; heading: string }[]; gap?: string; margin?: string }) {
  return (
    <ul style={{ margin, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap }}>
      {sections.map((s) => (
        <li key={s.id}>
          <a href={"#" + s.id} style={{ fontSize: "14px", textDecoration: "none", color: T.soft }}>
            {s.heading}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Where to write. No reply time: R24, 26 Sep 2026. */
export function StillStuck() {
  return (
    <div className="ac-row" style={{ ...CARD, padding: "22px" }}>
      <div style={MICRO}>Still stuck?</div>
      <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
        <HelpText text={STILL_STUCK} />
      </p>
    </div>
  );
}

/** The aside: the articles (not on the index, whose body lists them), this page's sections, and where to write. */
export function HelpAside({ current, sections = [] }: { current: string | null; sections?: { id: string; heading: string }[] }) {
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      {current ? (
        <nav aria-label="Help articles" className="ac-row" style={{ ...CARD, padding: "22px" }}>
          <div style={MICRO}>
            <TierText>{HELP_INDEX.title}</TierText>
          </div>
          <Articles current={current} />
        </nav>
      ) : null}
      {sections.length ? (
        <div className="ac-row post-toc-side" style={{ ...CARD, padding: "22px" }}>
          <div style={MICRO}>On this page</div>
          <Contents sections={sections} />
        </div>
      ) : null}
      <StillStuck />
    </aside>
  );
}

/** One help article. */
export default function HelpArticlePage({ slug }: { slug: string }) {
  const a = helpArticle(slug);
  return (
    <div className="post-shell" style={{ ...SHELL, paddingTop: "40px" }}>
      <article>
        <Link className="ac-row" href={HELP_PATH} style={{ display: "block", fontSize: "13px", fontWeight: 600, textDecoration: "none", color: T.accent }}>
          All help
        </Link>
        <h1 className="ac-row" style={{ margin: "20px 0 0", fontSize: "34px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.18, color: T.ink }}>
          <TierText>{a.title}</TierText>
        </h1>
        <p className="ac-row" style={{ margin: "14px 0 0", fontSize: "16px", lineHeight: 1.6, color: T.soft, maxWidth: "68ch" }}>
          <TierText>{a.standfirst}</TierText>
        </p>

        {/* Below 860px the aside drops under the article, so the contents sit
            here, folded, as a post's do (globals.css .post-toc-top). */}
        <details className="post-toc-top" style={{ ...CARD, marginTop: "18px", padding: "0 18px" }}>
          <summary style={{ ...MICRO, cursor: "pointer", lineHeight: "44px", display: "flex", justifyContent: "space-between" }}>
            <span>On this page</span>
            <span className="post-toc-show" style={{ color: T.accent }}>Show {a.sections.length}</span>
            <span className="post-toc-hide" style={{ color: T.accent }}>Hide</span>
          </summary>
          <Contents sections={a.sections} gap="0" margin="0 0 8px" />
        </details>

        <div style={{ marginTop: "8px", maxWidth: "68ch" }}>
          {a.sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id}>
              <H2 id={s.id}>
                <TierText>{s.heading}</TierText>
              </H2>
              <Blocks blocks={s.blocks} />
            </section>
          ))}
        </div>
      </article>

      <HelpAside current={slug} sections={a.sections} />
    </div>
  );
}
