/**
 * A product demo's recorder: `demo(name, description, { arrange, steps })`, each step a subtitle, an
 * action and a check. recorder.ts takes the frames, cursor.ts draws the pointer and makes every action
 * glide to its target, pace.ts is the viewer's clock, model.ts replays the model's words for a demo
 * that asks it, encode.ts turns the frames into the MP4.
 */
export { demo, type Demo, type Stage, type Step } from "./recorder";
export { model, type Model } from "./model";
export { hold } from "./pace";
