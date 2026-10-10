import { type By, FindingGroupRowHarness, FindingsBadgeHarness, type Handle, type Severity } from "@kanzo-tech/testing";

import { nameOf } from "./controls";

const CHECKED = /^Checked over /;
const SHOW = /^Show(ing)? ([\d,]+)$/;
const CONFORMS = "Show what conforms";
/** keasy#127's per-rule buttons: *Show all 44 violations*, *Show the 1 warning*. */
const SHOW_ALL = (severity: "violations" | "warnings") => new RegExp(`^Show (all [\\d,]+ ${severity}|the 1 ${severity.slice(0, -1)})$`);
const count = (words: string) => Number(/[\d,]+/.exec(words)?.[0]?.replace(/,/g, "") ?? Number.NaN);
const pressed = async (button: Handle) => (await button.attribute("aria-pressed")) === "true";
const WORD: Record<Severity, "Violation" | "Warning" | "Note"> = { violation: "Violation", warning: "Warning", info: "Note" };
const NOUN: Record<Severity, string> = { violation: "violation", warning: "warning", info: "note" };

/**
 * **The rules' badge** — kanzo-ui's `FindingsBadge` at the end of the filter bar, named by its tally
 * (*2 violations · 2 warnings*, *Conforms to the rules*, *Not checked*, *No rules*), and the popover
 * it opens: the file, *Check*, what the last check was over, and each rule a region of
 * `FindingGroupRow`s. Nothing validates until *Check* is pressed. Every read
 * opens the popover, and every Show closes it, as a person's press does.
 */
export class RulesBadge extends FindingsBadgeHarness {
  /**
   * Drops a rules file on the badge's file input, as a person drops one on the popover: `text` as a
   * file named `name`. The input is hidden and unnamed, so it is found by its type in the bar.
   */
  async drop(name: string, text: string, type = "text/turtle"): Promise<void> {
    const input = await this.one({ css: '[data-slot="filter-bar"] input[type="file"]' }, "the rules take no file", this.env.root);
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

  /**
   * Presses *Check* (or *Check again*) and waits for the check to end: rules validate only when
   * asked. Resolves with what they were checked over, *Checked over all 3,218 nodes*.
   */
  async check(): Promise<string> {
    await this.start();
    return this.checked();
  }

  /** Presses *Check* (or *Check again*) and returns at once: a long check is waited on by the caller. */
  async start(): Promise<void> {
    const dialog = await this.open();
    const button = await this.one({ role: "button", name: /^Check( again)?$/ }, "the rules offer no Check", dialog);
    await button.click();
    // React commits a press's update before the event returns: the line reads *Checking…* from here,
    // so `checked()` waits for this check, not the last one.
  }

  /** What the last check was over, once one has ended: *Checked over all 3,218 nodes*. */
  async checked(): Promise<string> {
    const dialog = await this.open();
    return this.env.until(async () => {
      const [scope] = await dialog.find({ css: '[data-slot="rules-scope"]' });
      const text = scope ? await scope.text() : "";
      return CHECKED.test(text) ? text : null;
    }, "the rules have not been checked");
  }

  /** Why the last check is out of date — *Filter changed since the last check* — or `null`. */
  async stale(): Promise<string | null> {
    const dialog = await this.open();
    const [line] = await dialog.find({ css: '[data-slot="rules-stale"]' });
    return line ? line.text() : null;
  }

  /** The rule named `name`: a region of the popover, found again on every read. */
  rule(name: string | RegExp): Promise<Rule> {
    return Promise.resolve(new Rule(this, name));
  }

  /** Presses *Show what conforms* (or presses it again, `false`), and waits for it to say so. */
  async conforms(on = true): Promise<void> {
    const button = async () => this.one({ role: "button", name: CONFORMS }, "the rules offer no Show what conforms", await this.open());
    if ((await pressed(await button())) === on) return;
    await (await button()).click();
    await this.env.until(async () => (await pressed(await button())) === on, `Show what conforms did not turn ${on ? "on" : "off"}`);
  }

  /** The popover's region for the rule `name`. */
  async region(name: string | RegExp): Promise<Handle> {
    const dialog = await this.open();
    return this.one({ role: "region", name }, `no rule is named ${String(name)}`, dialog);
  }

  // What a rule and its groups read through the badge, whose environment is its own.

  /** The first element `by` finds `within`, waited for. */
  findOne(by: By, what: string, within: Handle): Promise<Handle> {
    return this.one(by, what, within);
  }

  /** The library's group rows `within`. */
  rows(within: Handle): Promise<FindingGroupRowHarness[]> {
    return this.env.harnesses(FindingGroupRowHarness, within);
  }

  /** How many dialogs the page holds open: the popover's, or none. */
  async openDialogs(): Promise<number> {
    return (await this.env.root.find({ role: "dialog" })).length;
  }

  /** `read`, until it answers something. */
  until<T>(read: () => Promise<T | null | undefined>, what: string): Promise<T> {
    return this.env.until(read, what);
  }
}

/** **One rule**: its tally, its groups, and its Show buttons. */
export class Rule {
  constructor(
    private readonly badge: RulesBadge,
    private readonly name: string | RegExp,
  ) {}

  /** The region, the popover opened. */
  region(): Promise<Handle> {
    return this.badge.region(this.name);
  }

  /**
   * The rule's tally as its heading counts it — *2 violations · 2 warnings* — or *In order* when it
   * found nothing. A tally's badge carries its severity in `data-severity` and its figure as text.
   */
  async state(): Promise<string> {
    const region = await this.region();
    const counts = await region.evaluate(
      (host) =>
        [...host.querySelectorAll('[data-slot="findings-tally"] [data-severity]')].map((badge) => ({
          severity: badge.getAttribute("data-severity") ?? "",
          n: Number((badge.textContent ?? "").replace(/\D/g, "")),
        })),
      null,
    );
    if (counts.length > 0) return counts.map(({ severity, n }) => `${n.toLocaleString("en")} ${NOUN[severity as Severity]}${n === 1 ? "" : "s"}`).join(" · ");
    return (await region.text()).includes("In order") ? "In order" : "";
  }

  /** Every group of the rule, in the popover's order. */
  async findings(): Promise<RuleFinding[]> {
    const rows = await this.badge.rows(await this.region());
    return Promise.all(rows.map(async (row) => new RuleFinding(this, await row.message())));
  }

  /** The group whose message matches, waited for. */
  async finding(message: string | RegExp): Promise<RuleFinding> {
    const matches = (text: string) => (typeof message === "string" ? text.includes(message) : message.test(text));
    return this.badge.until(async () => {
      for (const row of await this.badge.rows(await this.region())) {
        const text = await row.message();
        if (matches(text)) return new RuleFinding(this, text);
      }
      return null;
    }, `the rule has no finding reading ${String(message)}`);
  }

  /** Shows the group that reads `message`; resolves with how many vertices it put on the page. */
  async show(message: string | RegExp): Promise<number> {
    return (await this.finding(message)).show();
  }

  /**
   * Presses *Show all N violations* (or *warnings*), keasy#127: every vertex the rule flags with that
   * severity, as the rules' one clause. Resolves with N once the press has closed the popover; the
   * page shows the vertices, so the popover is not opened again to read it pressed.
   */
  async showAll(severity: "violations" | "warnings"): Promise<number> {
    const button = await this.badge.findOne({ role: "button", name: SHOW_ALL(severity) }, `the rule offers no Show all ${severity}`, await this.region());
    const n = count(await nameOf(button));
    if (!(await pressed(button))) {
      await button.click();
      await this.badge.until(async () => (await this.badge.openDialogs()) === 0 || null, "the rules did not close");
    }
    return n;
  }

  /** Presses *Show all N violations* (or *warnings*) again, which takes those vertices off the page. */
  async hideAll(severity: "violations" | "warnings"): Promise<void> {
    const button = async () => this.badge.findOne({ role: "button", name: SHOW_ALL(severity) }, `the rule offers no Show all ${severity}`, await this.region());
    if (!(await pressed(await button()))) return;
    await (await button()).click();
    await this.badge.until(async () => !(await pressed(await button())), `Show all ${severity} is still pressed`);
  }

  /** Whether the rule offers *Show all* for `severity`: it does only when something has that severity. */
  async offersShowAll(severity: "violations" | "warnings"): Promise<boolean> {
    return (await (await this.region()).find({ role: "button", name: SHOW_ALL(severity) })).length > 0;
  }

  /** The first element `by` finds `within`, waited for. */
  findOne(by: By, what: string, within: Handle): Promise<Handle> {
    return this.badge.findOne(by, what, within);
  }

  /** The library's row for the group reading `message` exactly. */
  async row(message: string): Promise<FindingGroupRowHarness> {
    return this.badge.until(async () => {
      for (const row of await this.badge.rows(await this.region())) if ((await row.message()) === message) return row;
      return null;
    }, `the rule has no finding reading ${message}`);
  }
}

/**
 * **One group of a rule** — a `FindingGroupRow`: its severity, its message, and *Show N*, which puts
 * the N vertices it flags on the page as the rules' one clause and reads *Showing N* while it does.
 */
export class RuleFinding {
  constructor(
    private readonly rule: Rule,
    readonly message: string,
  ) {}

  /** *Violation*, *Warning* or *Note*. */
  async severity(): Promise<"Violation" | "Warning" | "Note"> {
    return WORD[await (await this.rule.row(this.message)).severity()];
  }

  /** How many vertices the group flags: the N of its *Show N*. */
  async flagged(): Promise<number> {
    return count(await nameOf(await this.button()));
  }

  /**
   * Presses *Show N* and resolves with N once the popover has closed, as the press closes it: the
   * page is what shows the N vertices, so it is not opened again to read *Showing N*.
   */
  async show(): Promise<number> {
    const label = await nameOf(await this.button());
    if (!SHOWING.test(label)) await (await this.rule.row(this.message)).act(SHOW);
    return count(label);
  }

  /** Presses *Showing N* again, which takes the group's vertices off the page. */
  async hide(): Promise<void> {
    if (!SHOWING.test(await nameOf(await this.button()))) return;
    await (await this.rule.row(this.message)).act(SHOWING);
  }

  private async button(): Promise<Handle> {
    const row = await this.rule.row(this.message);
    return this.rule.findOne({ role: "button", name: SHOW }, "the finding has no Show", row.host);
  }
}

const SHOWING = /^Showing [\d,]+$/;
