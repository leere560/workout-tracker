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
