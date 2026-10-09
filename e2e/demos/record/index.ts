/**
 * A product demo's recorder: `demo(name, description, { arrange, act })`, with `chapter` and
 * `poster` in `act`'s scene. recorder.ts takes the frames, cursor.ts draws the pointer and makes
 * every action glide to its target, encode.ts turns the frames into the MP4.
 */
export { demo, type Demo, type Scene } from "./recorder";
