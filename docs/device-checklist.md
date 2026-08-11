# Device checklist

Run on your own iPhone, NaviOS installed to the home screen. One gesture, one
observable, pass/fail. Where a step says *Safari*, open the site in a Safari tab
instead — those two are different environments and the difference is the point.

## Microphone (Phase 1.2 matrix — all four cells)

1. Safari tab · tap mic, first time ever → permission prompt appears.
2. Safari tab · allow, speak 3s, tap ✓ → transcript lands in the composer.
3. Safari tab · tap mic a second time → recording starts, no second prompt.
4. Safari tab · close tab, reopen site, tap mic → recording starts.
5. Home screen · tap mic, first time → permission prompt appears.
6. Home screen · allow, speak 3s, tap ✓ → transcript lands in the composer.
7. Home screen · tap mic a second time → recording starts, no second prompt.
8. Home screen · force-quit the app, relaunch, tap mic → recording starts.
9. Any cell that fails → the composer shows a sentence naming what happened,
   never a dead button.

## Microphone behaviour

10. While recording, speak → waveform bars move with your voice.
11. While recording, stay silent → bars settle to a flat row.
12. While recording → the clock counts **down** from 1:00.
13. Let it run to 0:00 → recording stops itself, transcription starts, a line
    says it stopped at the limit.
14. At 0:10 remaining → the clock turns amber.
15. Tap ✗ mid-recording → recording discarded, no transcript, no error.
16. Start recording, take a phone call, return → app shows an error or a
    transcript. It must not sit at "Transcribing…" forever.
17. Airplane mode, record, tap ✓ → a readable failure sentence within 45s.
18. Safari · Develop console, first record of the session → one
    `NaviOS recording support:` line listing containers and the chosen one.

## Controls marked `real` in the audit

19. Effort pill → change effort → next reply reflects it.
20. Research toggle on → next reply cites web sources.
21. `+` → Add photos → picker opens, chosen image appears as a chip.
22. `+` → Take a photo → camera opens.
23. Type `/` → command list appears; tap one → it fills the composer.
24. Send a `/` command with airplane mode on → it still answers.
25. Settings → General → Chat font → System → answers change typeface.
26. Settings → General → Density → Compact → message spacing tightens.
27. Settings → General → Motion → Reduced → drawer and sheets stop animating.
28. Settings → General → Appearance → Light → app switches, status bar follows.
29. Settings → Memory and storage → "On this device · Conversations" equals the
    number of chats in the drawer.
30. Signed out → "Synced to your account" says nothing is syncing. It must not
    show `Conversations 0`.
31. Settings → Playbooks → paste a long SKILL.md → notice says it was trimmed.
32. Connectors → `Test` on a configured provider → real pass/fail within ~12s.
33. Connectors → `Test` on an unconfigured provider → says it is not set.
34. Connectors → no environment-variable names appear anywhere on the screen.
35. Settings → Developer → Deployment settings lists them instead.
36. Settings → Account → App → Update NaviOS → checks and reports.
37. Drawer → no update row while the app is current.

## Drawer edge gesture

38. Home screen · drag from the left edge → drawer tracks your thumb.
39. Home screen · drag to 20% and release → drawer springs back.
40. Home screen · drag to 50% and release → drawer commits open.
41. Home screen · drag from the edge and let the finger leave the strip → drawer
    keeps following. It must not freeze part-open.
42. Home screen · drag from the edge, then drag down → gesture abandons.
43. Safari tab · same drag from the left edge → note whether Safari's back
    gesture takes it instead (Phase 3.3, unverified).

## Sheets

44. Open any bottom sheet, drag down slowly, release above halfway → snaps back.
45. Same, release below halfway → dismisses.
46. Same, short hard flick down → dismisses regardless of distance.
47. Sheet open → swipe from the left edge → drawer must not open behind it.

## Haptics

48. Drawer commits open → one tick.
49. Sheet dismissed by drag → one tick.
50. Tap copy on a response → one tick **on the tap**, then the check mark.
51. Tap send → one tick on the tap.
52. Long-press a message → one tick when the menu appears.
53. Tap copy on a code block, then the wrap button → both tick, equally.
54. Settings → Haptics off → repeat 48–53 → nothing ticks.

## Keyboard

55. Focus composer with 1 line of text → composer sits on the keyboard, header
    does not drift.
56. Type 6 lines → composer grows upward, stays pinned, thread scrolls.
57. Dismiss keyboard → composer returns without the header jumping.
58. Focus the composer → no page zoom.

## Streaming and launch

59. Send a long question, double-tap send rapidly during the stream → exactly
    one response, no duplicate.
60. During a stream, scroll up → view stays where you put it.
61. Long thread (30+ messages), scroll fast → no blank rows.
62. Cold launch from the home screen → splash to shell with no white flash and
    no colour shift.
63. Cold launch → previous conversations are present in the drawer.
64. Airplane mode → cold launch → app opens, chats readable, composer usable.
