-- 9 Oct 2026. ON-1 review (launch blocker LB8): one live prompt per text in a
-- cluster, held by the database. Additive only (create unique index if not
-- exists) under the 19 Sep 2026 authorisation. NOT APPLIED when written: it is
-- applied after integration and read back on real data.
--
-- Why: a cluster's five drafted prompts are saved by reading its live prompts
-- and room, then inserting (slot.ts fillSlots, limits.ts insertPrompts). The
-- reads are not a lock. A double click before the page hydrates, or setup and
-- Clusters open in two tabs, can pass both reads twice, and one cluster would
-- hold ten live prompts - asked every day, at twice its spend. This index
-- refuses the second insert; insertPrompts reads its 23505 as the duplicate
-- refusal the app already words ("That prompt is already tracked in this
-- cluster."), and because the five go in one insert, none of them is written.
--
-- The key is lower(btrim(text)) among live rows (stopped_on is null), so a
-- stopped prompt's text can be tracked again as a new row, as the free slot
-- allows. The app's own check (prompt-text.ts promptKey) is at least as strict
-- as this key, so the index only ever catches the race, never a text the page
-- let through.
--
-- Harmless before or after the deploy: the app already refuses a live
-- duplicate in a cluster, and the 23505 handling reads nothing new. Checked on
-- 9 Oct 2026: 25 live prompts, 0 duplicate groups on this key. Prompts with no
-- cluster (cluster_id null, the legacy ungrouped ones) are unaffected: NULLs
-- are distinct in a unique index.
create unique index if not exists tracked_questions_cluster_live_text_uniq
  on tracked_questions (cluster_id, lower(btrim(text)))
  where stopped_on is null;
