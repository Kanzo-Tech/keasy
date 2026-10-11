/**
 * **The one place a demo waits on a time**: a viewer's. Everything a demo does waits on a state — a
 * harness method resolves when what it caused is there — but a video also has to leave the words on
 * screen long enough to be read, and the cursor long enough to be seen arriving. Neither is the
 * page's state, so neither can be waited on; `hold` is that pacing, by the clock of the machine that
 * records, and never a wait for the page.
 */
/**
 * **Reading a subtitle.** On screen for a beat to find it (`FIND`) and then about 11 characters a
 * second (`PER_CHARACTER`), at least `MIN_EVENT` and at most `MAX_EVENT`. The Netflix Timed Text Style
 * Guide sets ceilings this stays well under — 20 characters a second for adults, 17 for children —
 * because a demo's viewer reads while watching the screen change; and its maximum event, 7 s, is ours.
 * The rate and the floor were calibrated against takes side by side (2026-10-11) and are named as such.
 * https://backlothelp.netflix.com/hc/en-us/articles/215758617
 */
const FIND = 1200;
const PER_CHARACTER = 90;
const MIN_EVENT = 3200;
const MAX_EVENT = 7000;

/**
 * **The tail: the result held still before the cut.** Once the last step's check has passed and its
 * reading time is over, the subtitle goes and the page is held, untouched, for `TAIL` before the
 * screencast stops. A take that stops as its last subtitle goes cuts away from the result just as
 * the eye leaves the words for it. About the reading floor (`MIN_EVENT`): long enough to see the
 * final frame as a frame. Decided with the demos' re-cut, 2026-10-11, and named as such, as the
 * constants above are. Every demo ends this way, so it is the recorder's, not a step's.
 */
export const TAIL = 3000;

export function hold(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, Math.max(0, ms)));
}

/** How long a subtitle of `text` must be on screen to be read. */
export function readingTime(text: string): number {
  return Math.min(MAX_EVENT, Math.max(MIN_EVENT, FIND + text.length * PER_CHARACTER));
}
