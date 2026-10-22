/**
 * Perception delay for bots (seconds, v0.5 human reference model).
 *
 * A human sees the TV picture late (TV processing ~70 ms, render frame) and the touch screen
 * adds its own latency (~40 ms). Bots read the state directly, so they add this delay on top
 * of their reaction time (`botRef(level).reaction`).
 *
 * - `BOT_DISPLAY_LAG`: games with phone timestamps on presses (NET-05 removes the network).
 * - `BOT_LIVE_LAG`: live inputs without timestamps (stick, tilt, swipe, choice, pads) – the
 *   network hop to the host adds roughly another 40 ms.
 */
export const BOT_DISPLAY_LAG = 0.11;
export const BOT_LIVE_LAG = 0.15;

/** Minimum gap between two counted taps of one player (caps two-thumb drumming at 10/s). */
export const TAP_MIN_GAP = 0.1;
/** Minimum gap between two counted shake impulses of one player (real shaking or tap fallback). */
export const SHAKE_MIN_GAP = 0.15;
