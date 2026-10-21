# Acceptance review

Reviewed 2026-10-19. Implementation delegated across workout logic, reporting/data, and mobile UI; integration reviewed separately.

## Preserved program

Automated comparison against the original routine confirms the five-day schedule, exercise names, prescribed sets and rep ranges are unchanged. Straight-set rests are at least 120 seconds and existing 180-second rests remain. Seated leg curl superset rest is 75 seconds; other supersets retain 60 seconds.

## Automated verification

Run `node --test tests/*.test.cjs` (32 tests). Coverage includes routine migration, alternating/uneven supersets, disabled supersets, minimum timer duration and restoration data, pending entries, equipment identity and baseline requirements, configurable increments, deload baseline protection, direct/indirect completed volume, transactional backup import and legacy compatibility, explicit updates, and offline shell handling.

Run `node --check` for app.js, routine-data.js, update-manager.js, accessibility.js and sw.js.

## Browser acceptance

Local responsive preview at 402 x 874: first set visible without scrolling, visible controls at least 44 pixels, pending weight/reps retained through reload. Widths 375, 390, 402 and 430 showed no horizontal overflow and visible input text was 16 pixels.

Confirmed three-minute hip thrust timer with early Skip disabled; final-set effort controls remain available until selected/skipped; Friday guidance alternates leg extension/curl and curl starts at 1:15. Changing increment to 2.5 updates stepper controls. Swap dialog focuses Close; Escape dismisses and restores focus to Swap equipment. Browser error/warning log was empty.

![Mobile preview](mobile-preview.jpg)

## Remaining device checks

Responsive browser testing does not validate physical iPhone Safari, home-screen installation, virtual keyboard behavior, VoiceOver, or sound/haptics while the phone is locked. Test these on the iPhone before relying on alerts. Service-worker lifecycle/offline behavior is covered by automated mocks; a real installed-PWA update/offline cycle remains a device acceptance check.

For local UI work, `python tests/preview_server.py` serves `/preview.html` without service-worker registration to avoid stale assets; `/index.html` serves the actual PWA.

## Header layout refinement (2026-10-20)

Replaced the crowded side-by-side day title/progress block with a padded session panel. Session progress and Finish workout share the first row; completed sets and planned duration sit above a full-width progress track. The workout name appears in the day picker, avoiding a duplicate heading. Finish uses a restrained green treatment so the current set remains the primary action.

Checked 375, 402, 430 and 1024 pixel widths: no horizontal overflow, a 44px Finish button, aligned panel edges, and a full-width track. At 402 x 874 the complete first set remains above the bottom dock. Completing a set updates the displayed count and progressbar value; Finish still opens the session summary. All 32 regression tests and JavaScript syntax checks pass. Physical iPhone verification remains outstanding.

![Refined mobile header](header-preview.jpg)

## Workflow and design release v29 (2026-10-20)

Implemented all eight recommendations in design-use-audit-2026-10-20.md. The routine invariant test confirms the prescribed program is unchanged.

- Current set: compact completed rows retain Edit and unanswered effort controls. Next set reveals the actual row above the dock. Final-set effort remains available; a completed workout presents Review & finish.
- Finish: review and Keep training preserve the active session. Confirm archives once and stops rest. Short elapsed sessions show <1 min. Recoverable snapshots reopen through the summary or Progress; a newer progressed draft is protected.
- Resume: last progressed day resumes on reload. Stale sessions have dated Resume/Start new choices. Start new preserves the old draft; the overview offers restoration. Backups include retained drafts and the selected day, including incomplete invalid input. Storage-write failures roll back finish/reopen changes.
- Design: compact combined progress/overview, consistent SVG navigation icons, flatter surfaces, readable secondary text, and Warmup/Swap plus saved setup cues near the heading.
- Rest: visible minimum-rest countdown replaces reliance on hover explanations; original straight-set and superset timing rules remain.
- Progress/settings: recent saved workout first, latest/previous lift comparison, expandable detailed trends and muscle volume, concise program overview, named toggles, and clear Backup/Update controls.
- Validation: completed working sets require valid load and positive whole reps. Blank or invalid pending edits remain available to correct.

Validation: `node --test tests/*.test.cjs` passes all 45 tests; JavaScript syntax and diff checks pass. Browser acceptance at 402 x 874 covers actual next-set reveal, compact Edit/Done, blocked zero-rep edits, Keep training, Finish early, timer stop, Reopen, pending final effort, off-schedule reload, Start new/Restore, alternating supersets, 75-second curl rest, saved setup cues, and a full 15-set workout. Widths 375, 390, 402, 430 and 1024 showed no horizontal overflow or visible controls below 44px, with form text at least 16px. Browser error/warning log was empty.

Screenshots use local test data. Physical iPhone Safari keyboard, VoiceOver and locked-screen alerts remain device checks. No production deployment was performed for this release.

![Workout workflow](workflow-preview.jpg)
![Recent workouts and lift comparison](progress-preview.jpg)
