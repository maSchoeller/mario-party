---
name: Würfel-Bande – Spielkarton
status: final
version: 0.6
colors:
  ink: "#2b2346"
  ink-soft: "#6b6384"
  paper: "#fff8ea"
  paper-2: "#f6ecd6"
  paper-3: "#ecdfc3"
  night: "#241c3d"
  pill: "#3c3170"
  good: "#3cb371"
  bad: "#e5484d"
  accent: "#ff8a3d"
  gold: "#ffc23d"
  star: "#f2a900"
  player-red: "#e8676b"
  player-blue: "#5f8fe0"
  player-green: "#5cc08a"
  player-yellow: "#f0c04a"
typography:
  display: { family: "Lilita One", weight: 400, use: "headings, numbers, buttons with one verb" }
  body: { family: "Nunito", weights: [500, 700, 800, 900], use: "running text, labels" }
rounded:
  sm: 12px
  md: 20px
  pill: 999px
spacing:
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s5: 24px
  s6: 32px
  s7: 48px
  tv-margin: 3.2vh
  tv-gap: 2vh
components:
  panel: { fill: "{colors.paper}", stroke: "3px {colors.ink}", edge: "0 5px 0 {colors.ink}", radius: "{rounded.md}" }
  button: { stroke: "3px {colors.ink}", edge: "0 4px 0 {colors.ink}", pressed: "translateY(3px), edge 1px" }
  nameplate: { band: "player color, display font, white text with ink shadow", body: "{colors.paper}" }
  pill: { fill: "{colors.pill}", text: white, font: display }
---

# Würfel-Bande – DESIGN.md

Source: implemented in `apps/web/src/common/base.css` (tokens), `host/host.css` (TV) and `play/play.css` (phone).
Before/after shots: `docs/screenshots/ui/before/` and `docs/screenshots/ui/after/`.

## Brand & Style

"Spielkarton": the UI looks like the printed parts of a board game box, with cream cardboard
tiles, a thick dark-plum print outline and a hard offset edge as if each tile lies on the table.
No glass, no blur, no soft drop shadow as the main depth cue. That is what made v0.5 read as
generic AI-generated web UI. The 3D board stays the star; the UI frames it like table furniture.

## Colors

- **Ink `#2b2346`** is the only outline and text color. Every panel, button and badge uses it.
- **Paper** tones are the surfaces. `paper` for panels, `paper-2` for inset areas (controls hint,
  segment buttons), `paper-3` for dividers.
- **Night `#241c3d`** is the backdrop outside the 3D scene (landing, phone, TV start, iris wipe)
  with a 6 % white dice pattern and a violet glow at the top.
- Signal colors: `good` = confirm/roll, `accent` = format badges and warnings, `gold` = focus
  ring, active player and 1st place, `bad` = negative values.
- Player colors are unchanged (gameplay contract); they always appear together with the shape
  (●▲■◆) for color-blind players.

## Typography

- **Lilita One** for everything you read from 3 m: titles, numbers (stars, coins, dice total,
  timer, countdown), primary buttons and nameplates.
- **Nunito 700–900** for sentences and labels. Never below 0.72 rem on the phone or 1.4 vh on the TV.

## Layout & Spacing

- 4-pt scale `s1…s7`. Phone: 16 px gap between panels, 16 px padding inside, 24 px around sheets.
- TV: every overlay keeps `tv-margin` (3.2 vh) to the screen edge and `tv-gap` (2 vh) to its
  neighbours. The gimmick card is placed below the top-right nameplate by calculation, not by a magic number.
- Panels never touch: the lobby subtitle is constrained between the two lobby panels, the
  minigame intro fades out the board nameplates, results dim them.

## Elevation & Depth

Exactly two levels: the flat **panel** (ink stroke + 5 px ink edge) and the **pressed** state
(edge shrinks to 1 px, element moves down). The TV adds one soft ambient shadow so panels
separate from bright 3D scenes.

## Shapes

Rounded rectangles (12/20 px), full pills for titles and badges, circles for avatars, rank badges and the joystick.

## Components

- **Nameplate (TV HUD):** colored band with shape, avatar, name, CPU tag. Cream body with star
  and coin tokens drawn in CSS (`.ico-star`, `.ico-coin`) instead of text glyphs. Active player:
  scale 1.08 + gold ring.
- **Phone header:** the same nameplate idea, a sticky cream bar with the player color underline,
  a round avatar, compact stats, a connection dot and the backpack button.
- **Action bar (phone lobby):** the start action is pinned to the bottom edge, so the chief no longer scrolls 4,000 px to find it.
- **Results:** title pill sits on the top edge of the panel, numbered rank badges in gold/silver/bronze.
- **Logo:** `apps/web/public/media/ui/logo.webp` (generated with ChatGPT image generation, see ASSETS_LICENSES.md).

## Do's and Don'ts

- Do outline every interactive element in ink. Don't introduce grey borders or blurred shadows.
- Do put light text on the night backdrop and ink text in panels. Don't put ink text straight on the night backdrop.
- Do use the spacing tokens. Don't hand-tune margins per screen.
- Don't add new emoji as UI icons where a drawn token exists (star, coin).
