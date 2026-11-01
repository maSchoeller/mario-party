# UI/UX review v0.5 → v0.6 (2026-11-01)

Method: `node scripts/ui-screenshots.mjs <url> <tag>` captures every overlay on TV (1600×900)
and phone (390×844 @2x). Before: `docs/screenshots/ui/before/`, after: `docs/screenshots/ui/after/`.

## Findings (v0.5) and what changed

| # | Screen | Finding | Severity | Fix |
|---|---|---|---|---|
| 1 | TV minigame intro | Intro panel covered the top-left nameplate | high | nameplates, gimmick and minimap fade while the intro is up; panel keeps `tv-margin` |
| 2 | Phone lobby (chief) | "Spiel starten" sat at the end of a ~4,000 px scroll | high | pinned action bar at the bottom; non-chiefs see "Warte auf den Bandenchef" in the same place |
| 3 | TV lobby | Join URL broke mid-word ("Co de ein"), sentence plus URL in one paragraph | medium | short hint + URL as a non-breaking chip without `http://` |
| 4 | TV lobby | Moderator subtitle ran under the players panel | medium | subtitle constrained between both lobby panels |
| 5 | TV start + landing | Plain white card on an empty white/blue page, emoji instead of a logo | medium | night backdrop with dice pattern, generated wordmark, device hints on the landing buttons |
| 6 | All | Generic look: translucent white cards, soft blur shadow, one font weight family | medium | "Spielkarton" system: ink outline, hard edge, Lilita One display face (DESIGN.md) |
| 7 | All | Spacing hand-tuned per screen (0.3–1 rem mixes, 2 vh vs 4 vh margins) | medium | 4-pt tokens `--s1…--s7`, TV `--tv-m` / `--tv-g`, gimmick position derived from the nameplate height |
| 8 | TV HUD | ★ and ● text glyphs for stars and coins render differently per OS | low | CSS-drawn star and coin tokens |
| 9 | TV results | Flat list, no podium feeling | low | title pill on the panel edge, gold/silver/bronze rank badges, HUD dimmed behind |
| 10 | Phone header | Long names truncated to "A…" next to stats, round, link badge and bag | low | connection shown as a dot, stats without pill frames, name gets the remaining room |
| 11 | Phone | No visible focus state for keyboard/switch users | low | gold `:focus-visible` ring; `prefers-reduced-motion` respected |

## Open (not changed)

- The TV lobby renders the 3D lobby island on a white sky. A themed sky or backdrop for the
  lobby scene would finish the start-to-lobby transition (render code, not overlay CSS).
- Character avatars are still system emoji on the phone. Rendered portraits of the 3D figures
  (Blender pipeline in `scripts/assets/blender`) would match the TV models.
- The wait screen shows an almost empty "Keine Items" panel; it could merge with the reactions panel.
