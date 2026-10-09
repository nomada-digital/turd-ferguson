import { appPath } from "../app-host.ts";

import { checkTime } from "./check-time.ts";
import { YOUNG_RANGE_DAYS } from "./date-range.ts";
import { addDays } from "./figures.ts";
import { setupChecks } from "./setup-landing.ts";

/**
 * The Overview's activation checklist (ON-3, 9 Oct 2026, launch blocker
 * LB8): four steps a new client's team takes in its first weeks, each with
 * where it is done, computed on the server from rows the dashboard already
 * keeps. Pure, so the rules run under node --test; the page hands it what it
 * read.
 *
 * 1. Confirm setup - a setup_confirmed row (setup-landing.ts). A client
 *    started before the setup page existed was set up by hand: done.
 * 2. First check read - a complete or partial tracking_runs row, which is
 *    what loadOverview's lastRun reads.
 * 3. Invite a teammate - more than one live member who sees this client
 *    (Settings' own read, settings-data.ts, so member scoping applies). Only
 *    owners invite, so anyone else is told who can.
 * 4. Open a report or download a CSV - a dashboard_events row the dashboard
 *    already records: `csv` from the report route, or a `view` of /reports
 *    from the page's usage beacon (usage.ts).
 *
 * Shown to a client in its trial or in its first YOUNG_RANGE_DAYS days - the
 * span the dashboard opens on "Since tracking began" - and never to an ended
 * one. Gone once every step is done.
 */

export type StepId = "setup" | "first" | "invite" | "report";

export type ActivationStep = {
  id: StepId;
  done: boolean;
  title: string;
  /** One sentence: what is left, or what was done. */
  detail: string;
  /** Where the step is done. */
  href: string;
  link: string;
};

/** Whether the checklist is for this client at all: in its trial, or in its first weeks, and not ended. */
export function activationShown(c: { status?: string; startedOn: string | null; today: string; trialEndsAt: string | null; now: number }): boolean {
  if (c.status === "ended") return false;
  const trial = !!c.trialEndsAt && Date.parse(c.trialEndsAt) > c.now;
  const young = c.startedOn === null || addDays(c.startedOn, YOUNG_RANGE_DAYS) > c.today;
  return trial || young;
}

export type ActivationInput = {
  slug: string;
  /** The member's role on this client. */
  role: string;
  market: string;
  today: string;
  startedOn: string | null;
  /** setup_confirmed is recorded; null when that read failed or was not needed. */
  confirmed: boolean | null;
  /** setup-landing.ts needsSetup: false for a client set up by hand before the setup page. */
  setupNeeded: boolean;
  /** A complete or partial check has been read. */
  firstRead: boolean;
  /** Prompts not stopped, as setup and the Overview count them. */
  livePrompts: number;
  /** The live members who see this client, with their roles (Settings' team). */
  members: readonly { email: string; role: string }[];
  /** A CSV downloaded or Reports opened on this client. */
  reportOpened: boolean;
  /** The moment the page treats as now (repo.now), so a first check still to come is said in the client's zone (ON-1 review). */
  now?: number;
};

/**
 * The four steps, in order, or null when the list is done. Every sentence is
 * fixed here; the only times in it are check-time.ts's, in the client's zone.
 */
export function activationSteps(p: ActivationInput): ActivationStep[] | null {
  const client = (rest: string) => appPath(`/${encodeURIComponent(p.slug)}${rest}`);
  const editor = p.role === "owner" || p.role === "editor";
  const owner = p.role === "owner";
  const setupDone = p.confirmed === true || !p.setupNeeded;
  const { first } = setupChecks({ startedOn: p.startedOn, today: p.today, market: p.market, livePrompts: p.livePrompts, ...(p.now === undefined ? {} : { now: p.now }) });
  const owners = p.members.filter((m) => m.role === "owner").map((m) => m.email);
  const team = p.members.length;

  const steps: ActivationStep[] = [
    {
      id: "setup",
      done: setupDone,
      title: "Confirm your setup",
      detail: setupDone
        ? "Your clusters are set up."
        : editor
          ? "Check each cluster's keyword and prompts, then confirm them."
          : "An owner or editor checks the clusters and confirms them.",
      href: client("/setup"),
      // Not the setup banner's own "Finish setup", which sits above it on the same page.
      link: setupDone || !editor ? "See setup" : "Go to setup",
    },
    {
      id: "first",
      done: p.firstRead,
      title: "First check read",
      detail: p.firstRead
        ? "Your readings are on this page, and on Clusters."
        : !p.livePrompts
          ? "Nothing is checked until a cluster has prompts. Save the five drafted from its keyword on setup."
          : first
            ? `The first check runs ${first}.`
            : `The next check runs tomorrow at ${checkTime(addDays(p.today, 1), p.market)}.`,
      href: p.livePrompts || p.firstRead ? client("/clusters") : client("/setup"),
      // "Go to Clusters", not the day-zero headline's own "See your prompts": one name, one link (journeys/app.spec.mts).
      link: p.firstRead ? "See your clusters" : p.livePrompts ? "Go to Clusters" : "Add prompts",
    },
    {
      id: "invite",
      done: team > 1,
      title: "Invite a teammate",
      detail:
        team > 1
          ? `${team} people can see this dashboard.`
          : owner
            ? "Give a colleague their own sign-in, as an editor or a viewer."
            : owners.length
              ? `Only an owner can invite: ask ${owners.join(" or ")}.`
              : "Only an owner can invite.",
      href: client(owner && team <= 1 ? "/settings#set-invite" : "/settings#set-team"),
      link: owner && team <= 1 ? "Invite someone" : "See your team",
    },
    {
      id: "report",
      done: p.reportOpened,
      title: "Open a report or download a CSV",
      detail: p.reportOpened ? "Your reports are on Reports, a month at a time." : "Reports has each month's figures, and every reading as a CSV.",
      href: client("/reports"),
      link: "Go to Reports",
    },
  ];
  return steps.every((s) => s.done) ? null : steps;
}
