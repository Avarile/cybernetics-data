● Agent Cockpit: analysis of the UI, the data and the Constellation

  Branch feat/agent-cockpit at 4da797ec. I read the whole cockpit folder, the backend search code that feeds it, and the reference ai-cockpit where the port differs from it. All 101 frontend specs
  in blocks/agent/ pass (10 files). I did not open the page in a browser; that is still P8. So everything below comes from reading the code, not from watching it run.

  Paths are short: frontend is under apps/nextjs-app/src/features/app/blocks/agent/, backend under apps/nestjs-backend/src/features/agent/.

  Bottom line

  The structure is solid: clean layers, a pure board reducer, stream parts checked with zod, throttled re-renders, and d3 loaded only with the Constellation. Three problems matter most:

  1. Constellation zoom is broken. Wheel-zooming does not zoom where the pointer is. Zooming in 2× at the chart's centre throws the chart into the top-left corner.
  2. The progress numbers come from a biased sample. A project's tasks are shown in link order, capped at 50. The readout counts those 50 cards, the model reads only 30 of them, and nobody gets
     totals by state.
  3. Stopping mid-search leaves the board stuck on "SEARCHING…" until the thread is reopened.

  1. What the page is

  ┌ ANNUNCIATOR: mark · thread menu · focus chip · status chip · MONO|CYBERPUNK · zulu clock · ⏻ ┐
  ├ STAGE ─────────────────────────────────────────────────────┬ ASK RAIL ──────────────────┤
  │ Readout: INTENT · LENS, summary, up to 7 KPIs, notes       │ transcript: question,      │
  │ Knobs: BOARD | CONSTELLATION [TREE] · ANSWER n | RETRIEVED │  plan legs, answer, tool   │
  │ Body:  lanes of cards (board)  or  radial SVG (constellation)│  rows, clarify, approvals │
  │ Run log (collapsible) · Legend                              │ suggestions · composer+voice│
  └────────────────────────────────────────────────────────────┴────────────────────────────┘

  - On and off: the cockpit is a portal on document.body. While it is on, #__next is set inert. Turning it off unmounts the screen but not the session: the chat and the boards live in a zustand
    AgentSession, so a reply keeps streaming while the cockpit is off.
  - Stage: shows the search selected in the transcript, or else the latest one. Old searches are replayed from GET /api/agent/searches/:id.
  - Under 900 px: the rail becomes a bottom sheet and the lanes become snap-scrolled tabs.

  2. The data path

  plan_search ─► RunSearch (server) ─► data-search-plan / -step / -hit / -lens parts
     └► agent_search row saved after every step          │
  browser: AgentChat.onData ─► boardEventOf (zod) ─► reduceBoard ─► session.boards[searchId]
     └► ChangeFeed (50 ms throttle) ─► useStage ─► SearchBoard | boardToGraph ─► limitGraph ─► layoutGraph

  Caps: 10 cards for the anchor step, 50 per other step, 500 per run, at most 300 linked records read per step, and 30 records per step go to the model.

  Card encoding (domain/search/card-projection.ts):
  - Tone comes from the first single select named like status/progress/state/stage, run through toneOf.
  - Size comes from priority, or failing that from an amount.
  - Alert means a due date has passed on an open record.
  - A card also carries up to 4 fields, a 200-character snippet, via (the record it was reached from), and links (every link cell). The Constellation's edges are built from links.

  On the live schema the tones come out right:
  - Projects: backlog→dim, preparing→target, in-progress→route, finalized→ink, onhold→caution, cancelled→faint.
  - Tasks: finished_reviewing and closed both count as DONE.

  3. The Constellation in depth

  How a board becomes a graph (model/graph/from-board.ts): one node per record. The first card of a record wins if the record appears more than once. Where a node hangs depends on its step's role:

  ┌──────────────────┬─────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │      Intent      │          Branches (roots)           │                                                           What hangs where                                                           │
  ├──────────────────┼─────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ project_progress │ goals as hubs (context step)        │ project under its goal → tasks under the project → knowledge under its first referrer; people as diamonds on a "People" hub, with    │
  │                  │                                     │ assigned_to / lead_by drawn as edges                                                                                                 │
  ├──────────────────┼─────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ goal_progress    │ the goal as a plain item            │ projects → tasks → knowledge; People hub                                                                                             │
  ├──────────────────┼─────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ task_lookup      │ projects as hubs                    │ the task under its project; People hub; knowledge under the task                                                                     │
  ├──────────────────┼─────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ person_work      │ the person as a plain circle        │ tasks and projects both directly under the person; task→project links as edges                                                       │
  │                  │ (anchor role)                       │                                                                                                                                      │
  ├──────────────────┼─────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ knowledge_lookup │ the matching entries                │ related entries, and the projects or tasks that cite them, under each entry                                                          │
  ├──────────────────┼─────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ finance_query    │ categories as hubs                  │ transactions under their category; payees on the "People" hub                                                                        │
  └──────────────────┴─────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Layout (model/graph/layout.ts):
  - BUNDLE uses d3.cluster: every leaf sits on the rim, and edges are routed through the tree with curveBundle.beta(0.85).
  - TREE uses d3.tree and draws radial lines from parent to child.
  - Siblings sort by kind, then tone, then label.
  - Labels run radially and flip on the left half. They are cut to 22 characters (28 for hubs), and all of them disappear at 260 or more nodes.

  Marks:
  - An item is a circle of radius 2.3 + 0.55×size.
  - NEXT is drawn as a hollow ring, a person as a diamond, a hub as a hollow circle.
  - Alert adds a caution halo. Colour follows tone, and records without a status draw as none, which uses the same dim colour as backlog.

  Draw limit (limit.ts): at most 900 nodes plus links. Records are ranked by alert, tone, size and how recent they are, and each parent that loses records gets a "+N more" marker. People and hubs
  are always kept.

  Lens and trace:
  - ANSWER narrows the chart to the cited records, keeping their uncited ancestors drawn faint.
  - Hover or pin dims everything outside the trace to 25%. The trace is the record, the card it was reached from, and the cards reached from it.

  Motion: one turn every 4 minutes, redrawn 8 times a second, held while hovering a node. Edges in the in-progress colour flow. Charts over 400 nodes plus links hold still, and reduced motion turns
  everything off.

  Constellation defects (worst first)

  1. Zoom pivot is wrong. Constellation.tsx:90 renders translate(w/2+x, h/2+y) scale(k), but d3-zoom expects its transform to be the outermost one.
     - Worked example: on an 800×600 chart, zooming from 1× to 2× with the pointer at the centre gives d3 a translate of (−400,−300). The page then renders translate(0,0) scale(2), so the chart's
       centre jumps to the top-left corner. In general the zoom pivots half a viewport below and to the right of the pointer.
     - The reference nests the groups the other way (tree.ts:370-371, gz > gc).
     - The fix is two nested <g>: the outer one takes transform.toString(), the inner one translate(w/2,h/2).
  2. The draw limit ignores the lens. The reference's limitGraph takes lens and ranks cited records first; the port dropped that option, even though the comment at limit.ts:2 still says the lens
     comes first. Past 900 nodes plus links, a cited record can fold into "+N more", and buildTree then drops the marker, so the record disappears from ANSWER. This only happens on large searches.
  3. The keys T, 0 and [ ] are not wired (useCockpitKeys.ts:70). The bundle/tree choice is local state in useStage.ts:20, so no key handler can reach it, and it resets to BUNDLE every time the
     cockpit is turned off and on. Resetting the zoom only works by double-click.
  4. The chart is unreachable by keyboard. Nodes are <g> elements with mouse handlers only, and the <svg> has role="img". The board's cards are buttons; the Constellation has no keyboard path at
     all.
  5. A record reached through an unshown record becomes an orphan. A follow step keeps all the records it read (up to 300) as sources for the next step, but shows only 50
     (run-search.usecase.ts:217). Knowledge reached through task #120:
     - becomes its own root spoke in the chart (from-board.ts:28);
     - shows via rec… · refer_knowledge on its board card, a raw id (RecordCard.tsx:46).
  6. ANSWER keeps empty hubs. layout.ts:68 keeps every hub, so the "People" hub and every goal stay drawn even when none of their records are cited.
  7. "People" is hard-coded for any actor step, so in finance the payees sit under "People".
  8. highlight_records({ view: 'constellation' }) does nothing. board.view is stored (search-board.ts:89) but nothing reads it.
  9. The trace follows only the first via link. Hovering a person lights the one task they were first reached from, not every task whose edge visibly connects to them.
  10. Motion and polish:
      - Nodes don't glide: they jump on every incoming card while a search streams.
      - Rotation recomputes the whole d3 layout 8 times a second instead of turning one layer (as-built §16.3 acknowledges this).
      - The rotation can stay paused if a hovered node unmounts before the pointer leaves it.
      - Tooltips are the browser's plain <title>, not the cockpit's styled tooltip.
      - The first frame draws at radius 80, before the size is measured.

  4. Data accuracy

  1. The sample is biased and there are three different totals (this affects the headline "how is project X going?" question).
     - byIds keeps the order of the link cell (search-reader.ts:107), so the 50 tasks shown are the first 50 linked (likely the oldest), not the open ones.
     - The readout's DONE %, IN PROGRESS and so on (metrics.ts:22) count those 50 cards.
     - The model receives 30 records per step (run-search.usecase.ts:29) and no totals by state; totals exist only for filter steps (:268).
     - The lane header says 50/132.
     - The "listed" hint telling the model it got a subset (:463) only appears when the size budget forces fewer records, never at the normal 30 cap.
     - The tasks are already fetched (up to 300), so counting them by state on the server and showing open ones first would fix both the readout and the answer.
  2. Stop in the middle of a search leaves the board stuck. chat.stop() closes the stream, so the final step and plan events never arrive, and AgentSession.stop() (session-store.ts:118) never marks
     the board. The running lane keeps blinking "SEARCHING…" and the readout says SEARCHING until the thread is reopened; the saved row is correct. A dropped connection does the same.
  3. ON HOLD counts some tasks twice (metrics.ts:43): it adds caution tasks and alert tasks. An overdue task that is on hold counts twice, and an overdue in-progress task counts under both IN
     PROGRESS and ON HOLD, so the KPIs don't add up to the number of tasks.
  4. Smaller data issues:
     - Tasks have no "todo"-like state in your schema, so NEXT is always 0 for project progress.
     - Goals have no status field, so every goal with a past deadline gets the alert halo, even if it was achieved.
     - toneOf would map "not started" to in-progress (it contains "start") and "invalid" to done (it contains "valid"). Neither value exists in today's data.
     - Still open from the earlier review: a reverse step's found count is capped at the step's card limit; metrics.ts hard-codes the table names.

  5. Other UI notes

  - Esc does the opposite of the design (useCockpitKeys.ts:63). It clears the lens override, which falls back to the default: ANSWER once records are cited. If you picked RETRIEVED, Esc switches you
    to ANSWER; on the default ANSWER it does nothing.
  - Lane numbers don't match step numbers. Lanes are numbered in lane order, plan legs in step order. In knowledge_lookup, lane 02 is step 03.
  - A reopened thread shows no times in the run log (--:--:--): replay doesn't restore them.
  - Cards appear late on a live search. The entrance delay is position × 60 ms, so a card that arrives late still waits for its position's delay.
  - Small gaps from the design: plan legs never collapse after the answer, and the suggestion chips are fixed text instead of using recent project names.
  - The CSS module is 1,096 lines, over the project's 500-line rule.

  6. What's working well

  - The layer rules are enforced by layers.spec.ts.
  - The board reducer is pure, ignores duplicate hits, and replay runs through the same reducer.
  - The lens is computed apart from the trace, so the readout and the chart hold still while you hover (the flicker from the earlier review is fixed).
  - Re-renders are throttled to 50 ms, and cards and the Constellation are memoized.
  - Fields that look like secrets are dropped from cards, and archived records are handled.
  - d3 loads in its own chunk, only with the Constellation.

  Suggested order

  1. The zoom fix (a few lines).
  2. Mark the board cancelled on stop.
  3. Counts by state and open-first ordering for follow steps.
  4. Pass the lens into limitGraph.
  5. Wire T, 0 and [ ], and move the layout choice into the cockpit store.
  6. Then the P8 run in real browsers.

  I've added these findings to the project memory (agent-cockpit-review). Nothing in the code was changed.

✻ Baked for 6m 53s · done 11:32 AM