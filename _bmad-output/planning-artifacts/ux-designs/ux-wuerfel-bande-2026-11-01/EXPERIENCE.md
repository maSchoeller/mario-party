---
status: final
version: 0.6
design: ./DESIGN.md
sources: [../../../../docs/spec/SPEC.md]
---

# Würfel-Bande – EXPERIENCE.md

## Foundation

Two screens per session: the **TV** (laptop on a TV, 3D board, no input during play) and up to
four **phones** (DOM controllers). Visual identity: DESIGN.md. Engine: Babylon.js scene with an
HTML overlay (`#ui` layers: hud, minimap, gimmick, center, mg, subtitle, overlay, toast, transition, system).

## Information Architecture

- TV: Start → Lobby (code + QR | player slots) → Board (4 corner nameplates, round pill, minimap,
  subtitle) ↔ Minigame (intro side panel → countdown → mg HUD → results) → Game over.
- Phone: Landing → Join → Lobby (figure, players, chief settings, pinned start) → Wait/Decide →
  Minigame intro (practice + ready) → Controller → Over.
- HUD hierarchy on the TV: 1. whose turn (gold ring, subtitle), 2. stars, 3. coins, 4. items, 5. minimap.

## Voice and Tone

Moderator "Käpt'n Plapperschnabel" speaks in short, cheeky German lines. UI labels are verbs
("Würfeln!", "Spiel starten"). Hints are one sentence.

## Component Patterns

- Panels never overlap. When an overlay needs the space, lower-priority layers fade
  (`#ui:has(.mg-intro)` hides nameplates, `#ui:has(.results)` dims them).
- The phone keeps exactly one primary action in view: roll button, ready button or the pinned start bar.

## State Patterns

Connected (green dot), relay (orange dot), host offline (⏳ badge), offline player (nameplate at
70 % opacity + 📵 tag), AFK countdown (sticky orange banner below the header), paused (night
scrim + card, chief gets "Weiter").

## Interaction Primitives

Pressed buttons move down by the edge height (tactile, matches the haptic `vibrate()`), selected
cards get a 4 px green ring, focus-visible gets a gold ring. `prefers-reduced-motion` turns off all animation.

## Accessibility Floor

Touch targets ≥ 48 px, color is always paired with a shape, text contrast ink-on-paper > 12:1,
white-on-night > 13:1, logo has alt text.

## Key Flows

**Anna hosts the party night.** She opens the landing page on the laptop: logo, two big choices
labelled by device. The TV shows the room code in a framed code box and the URL as a readable
chip. Friends join, and each slot fills with their avatar and color band. Anna (the chief)
picks the map on her phone and taps the always-visible **Spiel starten** bar. *Climax:* the
first minigame. The intro panel takes the left side, the board nameplates step back, ready
checks turn green one after another, the countdown slams in with an ink-outlined "3-2-1-Los!".
