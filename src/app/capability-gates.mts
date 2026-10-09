/**
 * Where the source withholds copy behind a capability, read as spans.
 *
 * `config/capabilities.ts` holds one flag per thing the product cannot do yet,
 * and copy that claims one is written inside `listIf(...)` or `onlyIf(...)`
 * naming the flags it needs (LB1, 8 Oct 2026). This reads every such call as
 * the span of source it covers, so a census can ask of any offset "is this
 * withheld, and by what".
 *
 * Not a test - a helper beside the tests, the way `dynamic-render.mts` is, so
 * the two censuses that read gates (`capability-claims` and
 * `white-label-claims`) read them one way.
 *
 * The span ends at the call's own closing parenthesis, counted over brackets of
 * all three kinds, with double-quoted strings and template literals skipped so
 * a bracket inside copy cannot end it early. Single quotes are NOT skipped:
 * this tree writes its strings in double quotes, and an apostrophe in JSX text
 * ("client's") would otherwise open a string that never closes. The cost is a
 * single-quoted string holding an unbalanced bracket, which the census's
 * closing rule reports rather than misreads.
 */

import { blankComments } from "../lib/source-read.mts";

export type Gate = {
  /** The capabilities the call names, as written: `"a"` or `["a", "b"]`. */
  needs: string[];
  /** Offsets into the source as given: the call's name to just past its `)`. -1 when it never closes. */
  start: number;
  end: number;
  /** 1-based line of the call. */
  line: number;
  /** What the call wraps, between its parentheses. */
  text: string;
};

/**
 * Comments blanked to spaces, every offset and line kept.
 *
 * `blankComments` empties a comment line, which keeps line numbers and moves
 * every offset after it. A row parsed from the raw source has to be placed
 * inside or outside a gate by offset, so this pads each emptied line back to
 * its length. `blankComments` either keeps a line or empties it, so the pad
 * is exact.
 */
export function blankKeepingOffsets(source: string): string {
  const raw = source.split("\n");
  const blank = blankComments(source).split("\n");
  return raw.map((line, i) => (blank[i] === line ? line : " ".repeat(line.length))).join("\n");
}

/** A call, not the definition: `function listIf<T>(` is skipped by the lookbehind. */
const CALL = /(?<!function )\b(?:listIf|onlyIf)(?:<[^<>()]*>)?\(/g;

function stringEnd(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") j++;
    else if (src[j] === '"' || src[j] === "\n") return j + 1;
  }
  return src.length;
}

/** The offset just past the `)` that closes the `(` at `open`, or -1. */
export function closeOf(src: string, open: number): number {
  let depth = 0;
  // Each `${` inside a template records the depth to return to the template at.
  const templates: number[] = [];
  let inTemplate = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inTemplate) {
      if (c === "\\") i++;
      else if (c === "`") inTemplate = false;
      else if (c === "$" && src[i + 1] === "{") {
        templates.push(depth);
        depth++;
        inTemplate = false;
        i++;
      }
      continue;
    }
    if (c === '"') {
      i = stringEnd(src, i) - 1;
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (templates.length && depth === templates[templates.length - 1]) {
        templates.pop();
        inTemplate = true;
        continue;
      }
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Every gate in a file's source, comments ignored. */
export function gatesIn(source: string): Gate[] {
  const src = blankKeepingOffsets(source);
  const out: Gate[] = [];
  for (const m of src.matchAll(CALL)) {
    const open = m.index + m[0].length - 1;
    const rest = src.slice(open + 1).trimStart();
    const one = /^"(\w+)"/.exec(rest);
    const many = /^\[([^\]]*)\]/.exec(rest);
    const needs = one ? [one[1]!] : many ? [...many[1]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!) : [];
    const end = closeOf(src, open);
    out.push({
      needs,
      start: m.index,
      end,
      line: src.slice(0, m.index).split("\n").length,
      text: end === -1 ? src.slice(open + 1) : src.slice(open + 1, end - 1),
    });
  }
  return out;
}

/** Whether a gate is withholding right now: any capability it names is off. */
export function withholds(gate: Gate, live: Readonly<Record<string, boolean>>): boolean {
  return gate.needs.some((c) => live[c] !== true);
}

/**
 * The prose a gate wraps: its double-quoted strings, the static parts of its
 * template literals, and its JSX text, whitespace collapsed. Only runs that
 * read as prose - a space and a word of three letters - so class names, sizes
 * and path data drop out.
 */
export function gatedCopy(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) out.push(m[1]!);
  for (const m of text.matchAll(/`((?:[^`\\]|\\.)*)`/g)) out.push(...m[1]!.split(/\$\{[^}]*\}/));
  for (const m of text.matchAll(/>([^<>{}]+)</g)) out.push(m[1]!);
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => / /.test(s) && /[a-z]{3}/i.test(s));
}
