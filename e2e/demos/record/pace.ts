/**
 * **The one place a demo waits on a time**: a viewer's. Everything a demo does waits on a state — a
 * harness method resolves when what it caused is there — but a video also has to leave the words on
 * screen long enough to be read, and the cursor long enough to be seen arriving. Neither is the
 * page's state, so neither can be waited on; `hold` is that pacing, by the clock of the machine that
 * records, and never a wait for the page.
 */
/**
 * How much slower than a quick reader a demo is paced: every viewer's beat — a subtitle's reading
 * time, its lead over the action, the cursor's glide, a keystroke — is this many times its base.
 * The page's own motion (a layout, a transition, the timeline's play) keeps its real speed.
 */
export const PACE = 2;

export function hold(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, Math.max(0, ms)));
}

/** How long a subtitle of `text` stays up at the least: a beat to find it, then about 15 characters a second. */
export function readingTime(text: string): number {
  return PACE * Math.min(3600, Math.max(1600, 600 + text.length * 45));
}
