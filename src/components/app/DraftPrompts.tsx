import SubmitButton from "@/components/app/SubmitButton";
import { T } from "@/config/tokens";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";
import { ANGLES } from "@/lib/tracking/limits";
import { draftField } from "@/lib/tracking/setup-drafts";
import { PROMPT_MIN } from "@/lib/tracking/slot";

/**
 * ON-1 (9 Oct 2026, LB8): the five prompts drafted from a cluster's keyword
 * (setup-drafts.ts draftsFor), each in an editable field labelled with its
 * angle, and one Save. A plain POST to the free slot's route (/prompt) with
 * the cluster in the action's query string, so it works with JS off and
 * carries no hidden field. Drawn on the setup card and on an empty Clusters
 * row, for owners and editors only; a viewer is told who saves them.
 */
export default function DraftPrompts({
  id,
  action,
  keyword,
  drafts,
  note,
  noteTone = "soft",
  invalid = false,
}: {
  /** Unique on the page: the fields are `${id}-0` to `${id}-4`. */
  id: string;
  action: string;
  keyword: string;
  drafts: readonly string[];
  /** The line under the fields: what Save does, or what the last Save did. */
  note: string;
  noteTone?: "soft" | "good" | "bad";
  /** The last Save was refused: the first field is marked and takes focus. */
  invalid?: boolean;
}) {
  const color = noteTone === "good" ? T.goodFg : noteTone === "bad" ? T.badFg : T.soft;
  return (
    <form method="post" action={action} aria-labelledby={`${id}-h`} style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
      <span id={`${id}-h`} style={{ fontSize: "13px", fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>
        {`Five prompts about “${keyword}”, drafted from the keyword`}
      </span>
      <span style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft }}>Each asks for a recommendation the way a buyer would, so it shows whether the engines name you. Edit any of them, then save.</span>
      {drafts.map((text, i) => (
        <div key={ANGLES[i]} className="app-cl-edit" style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", alignItems: "center", gap: "12px" }}>
          <label htmlFor={`${id}-${i}`} style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: T.soft }}>
            {ANGLES[i]}
          </label>
          <input
            id={`${id}-${i}`}
            name={draftField(i)}
            defaultValue={text}
            required
            minLength={PROMPT_MIN}
            maxLength={ADMIN_LIMITS.question}
            aria-describedby={`${id}-note`}
            aria-invalid={invalid && i === 0 ? true : undefined}
            autoFocus={invalid && i === 0}
            style={{ height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "10px", fontFamily: "inherit", fontSize: "14px", color: T.ink, background: T.surface, minWidth: 0, width: "100%" }}
          />
        </div>
      ))}
      <p id={`${id}-note`} role={noteTone === "good" ? "status" : noteTone === "bad" ? "alert" : undefined} style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color }}>
        {note}
      </p>
      <div>
        <SubmitButton busy="Saving..." style={{ height: "44px", padding: "0 18px", border: 0, borderRadius: "10px", background: T.accent, color: T.surface, fontFamily: "inherit", fontSize: "14px", fontWeight: 600 }}>
          Save these prompts
        </SubmitButton>
      </div>
    </form>
  );
}
