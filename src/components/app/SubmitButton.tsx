"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * R151 (1 Oct 2026): a submit button for a plain HTML form posted to a route,
 * where nothing moves until the redirect lands. From its form's submit it
 * reads `busy` with the .btn-spin ring, aria-disabled, and stops a second
 * submit - Check keyword is a paid read, and two clicks on the Add panel's
 * step 2 can both pass new-cluster.ts's already-tracked read. An invalid form never fires
 * submit, so the browser's own message still shows. Back from the next page
 * restores this one from the bfcache with busy set, so pageshow clears it.
 * Without script it is an ordinary submit button. `form` is for a button
 * drawn outside its form (Clusters' Save changes); `.form` follows it.
 */
export default function SubmitButton({ children, busy: busyText, style, form }: { children: ReactNode; busy: string; style: CSSProperties; form?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    let held = false;
    const onSubmit = (e: SubmitEvent) => {
      // A submit a page check stopped first (DraftsCheck, ON-1 review) never posts, so it is not busy.
      if (e.submitter !== ref.current || e.defaultPrevented) return;
      if (held) e.preventDefault();
      else {
        held = true;
        setBusy(true);
      }
    };
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      held = false;
      setBusy(false);
    };
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  return (
    <button ref={ref} type="submit" form={form} aria-disabled={busy || undefined} style={{ ...style, cursor: busy ? "progress" : "pointer" }}>
      {busy ? (
        <>
          <span className="btn-spin" aria-hidden="true" />
          {busyText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
