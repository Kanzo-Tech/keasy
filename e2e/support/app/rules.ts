import { ComponentHarness, type By, type Handle, type HarnessQuery } from "@kanzo-tech/testing";

import { nameOf } from "./controls";

const CHECKED = /^Checked over /;
const SHOW = /^Show(ing)? ([\d,]+)$/;
const CONFORMS = "Show what conforms";
/** keasy#127's per-rule buttons: *Show all 44 violations*, *Show the 1 warning*. */
const SHOW_ALL = (severity: "violations" | "warnings") => new RegExp(`^Show (all [\\d,]+ ${severity}|the 1 ${severity.slice(0, -1)})$`);
const count = (words: string) => Number(/[\d,]+/.exec(words)?.[0]?.replace(/,/g, "") ?? Number.NaN);
const pressed = async (button: Handle) => (await button.attribute("aria-pressed")) === "true";

/**
 * **One finding of a rule** — a row of keasy's findings, `Diagnostic` from `@kanzo-tech/ui`: its
 * severity's word, its message, and *Show N*, which puts the N vertices it flags on the page as the
 * panel's one clause and reads *Showing N* while it does.
 *
 * Not the library's `FindingHarness`: keasy lists its findings as `Diagnostic`s inline, not in a
 * `Findings` popover. A `Diagnostic` has no role of its own, so the rows are found by its `data-slot`.
 */
export class RuleFinding extends ComponentHarness {
  static readonly by: By = { css: '[data-slot="diagnostic"]' };

  /** *Violation*, *Warning* or *Note*: the word the row opens with. */
  async severity(): Promise<"Violation" | "Warning" | "Note"> {
    const text = await this.host.text();
    const word = (["Violation", "Warning", "Note"] as const).find((w) => text.startsWith(w));
    if (!word) throw new Error(`the finding names no severity: ${text}`);
    return word;
  }

  /** How many vertices the finding flags: the N of its *Show N*. */
  async flagged(): Promise<number> {
    return count(await nameOf(await this.button()));
  }

  /** Presses *Show N* and waits for it to read *Showing N*; resolves with N. */
  async show(): Promise<number> {
    const button = await this.button();
    if (!(await pressed(button))) {
      await button.click();
      await this.env.until(() => pressed(button), "the finding's Show was not pressed");
    }
    return count(await nameOf(button));
  }

  /** Presses *Showing N* again, which takes the finding's vertices off the page. */
  async hide(): Promise<void> {
    const button = await this.button();
    if (!(await pressed(button))) return;
    await button.click();
    await this.env.until(async () => !(await pressed(button)), "the finding is still shown");
  }

  private button(): Promise<Handle> {
    return this.one({ role: "button", name: SHOW }, "the finding has no Show");
  }
}

/** **One rule of the panel**: a region named by the rule, with its tally, its findings and its Show buttons. */
export class Rule extends ComponentHarness {
  static readonly by: By = { role: "region" };

  static with(options: { name: string | RegExp }): HarnessQuery<Rule> {
    return { type: Rule, by: { role: "region", name: options.name } };
  }

  /**
   * The rule's tally as its badges name it — *2 violations · 2 warnings* — or *In order* when it
   * found nothing. A badge is named by `aria-label` and has no role, so the labels are read off the
   * host rather than found by one.
   */
  async state(): Promise<string> {
    const tally = await this.host.evaluate(
      (rule) =>
        [...rule.querySelectorAll("[aria-label]")]
          .map((badge) => badge.getAttribute("aria-label") ?? "")
          .filter((label) => /^[\d,]+ (violation|warning|note)s?$/.test(label)),
      null,
    );
    if (tally.length > 0) return tally.join(" · ");
    return (await this.host.text()).includes("In order") ? "In order" : "";
  }

  /** Every finding of the rule, in the panel's order. */
  async findings(): Promise<RuleFinding[]> {
    return this.env.harnesses(RuleFinding, this.host);
  }

  /** The finding whose message matches, waited for. */
  async finding(message: string | RegExp): Promise<RuleFinding> {
    return this.env.until(async () => {
      for (const finding of await this.findings()) {
        const text = await finding.host.text();
        if (typeof message === "string" ? text.includes(message) : message.test(text)) return finding;
      }
      return null;
    }, `the rule has no finding reading ${String(message)}`);
  }

  /** Shows the finding that reads `message`; resolves with how many vertices it put on the page. */
  async show(message: string | RegExp): Promise<number> {
    return (await this.finding(message)).show();
  }

  /**
   * Presses *Show all N violations* (or *warnings*), keasy#127: every vertex the rule flags with that
   * severity, as the panel's one clause. Waits for it to be pressed; resolves with N.
   */
  async showAll(severity: "violations" | "warnings"): Promise<number> {
    const button = await this.one({ role: "button", name: SHOW_ALL(severity) }, `the rule offers no Show all ${severity}`);
    if (!(await pressed(button))) {
      await button.click();
      await this.env.until(() => pressed(button), `Show all ${severity} was not pressed`);
    }
    return count(await nameOf(button));
  }

  /** Presses *Show all N violations* (or *warnings*) again, which takes those vertices off the page. */
  async hideAll(severity: "violations" | "warnings"): Promise<void> {
    const button = await this.one({ role: "button", name: SHOW_ALL(severity) }, `the rule offers no Show all ${severity}`);
    if (!(await pressed(button))) return;
    await button.click();
    await this.env.until(async () => !(await pressed(button)), `Show all ${severity} is still pressed`);
  }

  /** Whether the rule offers *Show all* for `severity`: it does only when something has that severity. */
  async offersShowAll(severity: "violations" | "warnings"): Promise<boolean> {
    return (await this.host.find({ role: "button", name: SHOW_ALL(severity) })).length > 0;
  }
}

/**
 * **The Rules panel** — keasy's own: a rules file dropped on it is read by rudof on the server and
 * saved; rudof in the browser checks it over the page's subset (*Checked over all 3,218 nodes*, or
 * *Checked over the selection: 4 of 20 nodes*), and each rule is a region of findings.
 */
export class RulesPanel extends ComponentHarness {
  static readonly by: By = { role: "complementary", name: "Rules panel" };

  /**
   * Drops a rules file on the panel, as a person drops one: `text` as a file named `name`, put on the
   * panel's file input. The input is hidden and unnamed — the drop zone is what a reader sees — so it
   * is found by its type.
   */
  async drop(name: string, text: string, type = "text/turtle"): Promise<void> {
    const input = await this.one({ css: 'input[type="file"]' }, "the panel takes no file");
    await input.evaluate(
      (element, file) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([file.text], file.name, { type: file.type }));
        (element as HTMLInputElement).files = transfer.files;
        // What a browser fires when a file is picked, in its order: Ark's FileUpload reads `input`.
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { name, text, type },
    );
  }

  /** What the rules were checked over, once they have been: *Checked over all 3,218 nodes*. */
  async checked(): Promise<string> {
    const line = await this.one({ text: CHECKED }, "the rules have not been checked");
    return line.text();
  }

  /** The rule named `name`. */
  rule(name: string | RegExp): Promise<Rule> {
    return this.locate(Rule.with({ name }));
  }

  /** Presses *Show what conforms* (or presses it again, `false`), and waits for it to say so. */
  async conforms(on = true): Promise<void> {
    const button = await this.one({ role: "button", name: CONFORMS }, "the panel offers no Show what conforms");
    if ((await pressed(button)) === on) return;
    await button.click();
    await this.env.until(async () => (await pressed(button)) === on, `Show what conforms did not turn ${on ? "on" : "off"}`);
  }
}
