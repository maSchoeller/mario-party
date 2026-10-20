/**
 * Extra reaction delay for bots in reaction / timing games (seconds).
 *
 * NET-05 removes the network latency from human presses (phone timestamps), but a human
 * still sees the TV picture late (TV processing, render frame) and the touch screen adds
 * its own latency – together roughly 100 ms. Bots read the state directly, so they get
 * this delay on top of their reaction to stay beatable for practised players.
 */
export const BOT_DISPLAY_LAG = 0.1;
