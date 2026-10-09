"use client";

import { useEffect, useRef } from "react";

import { refuseDraftsAt } from "@/lib/tracking/prompt-text";

/**
 * ON-1 review (9 Oct 2026): the drafts' rule (prompt-text.ts refuseDraftsAt,
 * the same function the route runs) checked in the browser before the form
 * posts. A member with script who types two prompts the same keeps every edit:
 * the post is stopped, the field it is about is marked and takes focus, and
 * the line under the fields says why. Without script the route refuses as
 * before and the card says the fields were reset. Draws nothing.
 *
 * It listens in the capture phase on its form, so it runs before SubmitButton,
 * which skips a submit already stopped here.
 */
export default function DraftsCheck({ fields, note, bad }: { fields: readonly string[]; note: string; bad: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ids = fields.join(" ");
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      const inputs = ids.split(" ").map((id) => document.getElementById(id) as HTMLInputElement | null);
      if (inputs.some((i) => !i)) return;
      for (const i of inputs) i!.removeAttribute("aria-invalid");
      const r = refuseDraftsAt(inputs.map((i) => i!.value), inputs.length);
      if (!r) return;
      e.preventDefault();
      const line = document.getElementById(note);
      if (line) {
        line.textContent = r.message;
        line.setAttribute("role", "alert");
        line.style.color = bad;
      }
      const at = inputs[r.at ?? 0]!;
      at.setAttribute("aria-invalid", "true");
      at.focus();
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [ids, note, bad]);
  return <span ref={ref} hidden />;
}
