import type { Handle, HarnessEnvironment } from "@kanzo-tech/testing";

/**
 * The form controls keasy's panels are made of, as a harness operates them: Ark's radio group, select
 * and slider. Each acts as a reader does and resolves once the control says it changed, never after
 * a time.
 */

/** A control's accessible name: its label where it has one, else its text. */
export async function nameOf(element: Handle): Promise<string> {
  return (await element.attribute("aria-label")) ?? (await element.text());
}

/** Whether a radio or checkbox is checked: a native input by its property, an ARIA one by its state. */
export function isChecked(element: Handle): Promise<boolean> {
  return element.evaluate(
    (el) => (el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true"),
    null,
  );
}

/**
 * Picks `option` in the radio group named `group`. Ark draws the card over its input, so the
 * option's own words are what is pressed, as a person would; it resolves once the radio is checked.
 */
export async function chooseRadio(env: HarnessEnvironment, within: Handle, group: string, option: string): Promise<void> {
  const radios = await env.until(async () => (await within.find({ role: "radiogroup", name: group }))[0], `no radio group ${group}`);
  const radio = await env.until(async () => (await radios.find({ role: "radio", name: option }))[0], `${group} has no ${option}`);
  if (await isChecked(radio)) return;
  const [words] = await radios.find({ text: option });
  if (!words) throw new Error(`${group}'s ${option} has no words to press`);
  await words.click();
  await env.until(() => isChecked(radio), `${group} did not change to ${option}`);
}

/**
 * Picks `option` in the select named `label`: the trigger, then the option in the list it opens (a
 * portal, so it is looked for on the whole page). It resolves once the trigger reads the option.
 */
export async function chooseOption(env: HarnessEnvironment, within: Handle, label: string, option: string): Promise<void> {
  const trigger = await env.until(async () => (await within.find({ role: "combobox", name: label }))[0], `no select ${label}`);
  if ((await trigger.text()).includes(option)) return;
  await trigger.click();
  const item = await env.until(async () => (await env.root.find({ role: "option", name: option }))[0], `${label} offers no ${option}`);
  await item.click();
  await env.until(async () => (await trigger.text()).includes(option), `${label} did not change to ${option}`);
}
