import { type By, FindingsBadgeHarness, FindingsItemHarness, type TestElement } from "@kanzo-tech/testing";

import { nameOf } from "./controls";

/** A finding's severity, as the findings harness reads it (`@kanzo-tech/ui`'s `FindingSeverity`). */
type Severity = Awaited<ReturnType<FindingsItemHarness["severity"]>>;

/** The scope line once a check has ended: *All 3,218 nodes checked · 2,930 conform*, *4 of 20 nodes checked · 4 conform*. */
const CHECKED = /\bnodes checked\b/;
/** A Show — of a rule, at the end of its heading, or of one of its groups — a toggle named *Show N*. */
const SHOW = /^Show [\d,]+$/;
const CONFORMS = "Keep what conforms";
/** A rule's own Show, at the end of its heading: the group's items hold theirs in a line of their own. */
const RULE_SHOW = { css: '[data-slot="findings-actions"] [data-slot="findings-action"]' };
const count = (words: string) => Number(/[\d,]+/.exec(words)?.[0]?.replace(/,/g, "") ?? Number.NaN);
const pressed = async (button: TestElement) => (await button.getAttribute("aria-pressed")) === "true";
const WORD: Record<Severity, "Violation" | "Warning" | "Note"> = { violation: "Violation", warning: "Warning", info: "Note" };
const NOUN: Record<Severity, string> = { violation: "violation", warning: "warning", info: "note" };

/**
 * **The rules' badge** — kanzo-ui's `FindingsBadge` at the end of the filter bar, named by its tally
 * (*2 violations · 2 warnings*, *Conforms to the rules*, *Not checked*, *No rules*), and the popover
 * it opens: the file, *Check*, what the last check was over and how much of it conforms, *Keep what
 * conforms*, and each rule a region with its own *Show N* and a `FindingsItem` per group. Nothing
 * validates until *Check* is pressed. Every read opens the popover, and every Show closes it, as a
 * person's press does.
 */
export class RulesBadge extends FindingsBadgeHarness {
  /**
   * Drops a rules file on the badge's file input, as a person drops one on the popover: `text` as a
   * file named `name`. The input is hidden and unnamed, so it is found by its type in the bar.
   */
  async drop(name: string, text: string, type = "text/turtle"): Promise<void> {
    const input = await this.locatorFor({ css: '[data-slot="filter-bar"] input[type="file"]' }, "the rules take no file")(this.env.rootElement);
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
   * asked. Resolves with what they were checked over, *All 3,218 nodes checked · 2,930 conform*.
   */
  async check(): Promise<string> {
    await this.start();
    return this.checked();
  }

  /** Presses *Check* (or *Check again*) and returns at once: a long check is waited on by the caller. */
  async start(): Promise<void> {
    const dialog = await this.open();
    const button = await this.locatorFor({ role: "button", name: /^Check( again)?$/ }, "the rules offer no Check")(dialog);
    await button.click();
    // React commits a press's update before the event returns: the line reads *Checking…* from here,
    // so `checked()` waits for this check, not the last one.
  }

  /** What the last check was over, once one has ended: *All 3,218 nodes checked · 2,930 conform*. */
  async checked(): Promise<string> {
    const dialog = await this.open();
    return this.env.until(async () => {
      const [scope] = await dialog.find({ css: '[data-slot="rules-scope"]' });
      const text = scope ? await scope.text() : "";
      return CHECKED.test(text) ? text : null;
    }, "the rules have not been checked");
  }

  /**
   * Why the last check is out of date — *Filter changed since the last check*, said at the end of
   * the scope line, which turns the warning colour — or `null`.
   */
  async stale(): Promise<string | null> {
    const dialog = await this.open();
    const [reason] = await dialog.find({ css: '[data-slot="rules-stale"]' });
    return reason ? (await reason.text()).replace(/^\s*·\s*/, "") : null;
  }

  /**
   * Closes the popover, if it is open, with Escape, as a person does: it is modal, so the badge
   * under its layer takes no click until it has closed.
   */
  async close(): Promise<void> {
    const [dialog] = await this.env.rootElement.find({ role: "dialog" });
    if (!dialog) return;
    await dialog.sendKeys("Escape");
    await this.env.until(async () => (await this.openDialogs()) === 0, "the rules did not close");
  }

  /** The rule named `name`: a region of the popover, found again on every read. */
  rule(name: string | RegExp): Promise<Rule> {
    return Promise.resolve(new Rule(this, name));
  }

  /**
   * Presses *Keep what conforms* (or presses it again, `false`), and resolves once the press has
   * closed the popover: the page is what shows what it kept, so the popover is not opened again.
   */
  async conforms(on = true): Promise<void> {
    const button = await this.locatorFor({ role: "button", name: CONFORMS }, "the rules offer no Keep what conforms")(await this.open());
    if ((await pressed(button)) === on) return;
    await button.click();
    await this.env.until(async () => (await this.openDialogs()) === 0 || null, "the rules did not close");
  }

  /** The popover's region for the rule `name`. */
  async region(name: string | RegExp): Promise<TestElement> {
    const dialog = await this.open();
    return this.locatorFor({ role: "region", name }, `no rule is named ${String(name)}`)(dialog);
  }

  // What a rule and its groups read through the badge, whose environment is its own.

  /** The first element `by` finds `within`, waited for. */
  findOne(by: By, what: string, within: TestElement): Promise<TestElement> {
    return this.locatorFor(by, what)(within);
  }

  /** The library's items `within`. */
  rows(within: TestElement): Promise<FindingsItemHarness[]> {
    return this.env.getAllHarnesses(FindingsItemHarness, within);
  }

  /** How many dialogs the page holds open: the popover's, or none. */
  async openDialogs(): Promise<number> {
    return (await this.env.rootElement.find({ role: "dialog" })).length;
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
  region(): Promise<TestElement> {
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
   * Presses the rule's own *Show N*, at the end of its heading: every vertex the rule flags, of any
   * severity, each once, as the rules' one clause. Resolves with N once the press has closed the
   * popover; the page shows the vertices, so the popover is not opened again to read it pressed.
   */
  async showAll(): Promise<number> {
    const button = await this.badge.findOne(RULE_SHOW, "the rule offers no Show", await this.region());
    const n = count(await nameOf(button));
    if (!(await pressed(button))) {
      await button.click();
      await this.badge.until(async () => (await this.badge.openDialogs()) === 0 || null, "the rules did not close");
    }
    return n;
  }

  /** Presses the rule's *Show N* again, which takes those vertices off the page. */
  async hideAll(): Promise<void> {
    const button = async () => this.badge.findOne(RULE_SHOW, "the rule offers no Show", await this.region());
    if (!(await pressed(await button()))) return;
    await (await button()).click();
    await this.badge.until(async () => !(await pressed(await button())), "the rule's Show is still pressed");
  }

  /** Whether the rule offers its own *Show N*: it does only when it flags something. */
  async offersShowAll(): Promise<boolean> {
    return (await (await this.region()).find(RULE_SHOW)).length > 0;
  }

  /** The first element `by` finds `within`, waited for. */
  findOne(by: By, what: string, within: TestElement): Promise<TestElement> {
    return this.badge.findOne(by, what, within);
  }

  /** The library's item for the group reading `message` exactly. */
  async row(message: string): Promise<FindingsItemHarness> {
    return this.badge.until(async () => {
      for (const row of await this.badge.rows(await this.region())) if ((await row.message()) === message) return row;
      return null;
    }, `the rule has no finding reading ${message}`);
  }
}

/**
 * **One group of a rule** — a `FindingsItem`: its severity, its message, and *Show N*, a toggle that
 * puts the N vertices it flags on the page as the rules' one clause and reads pressed while it does.
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
   * page is what shows the N vertices, so it is not opened again to read it pressed.
   */
  async show(): Promise<number> {
    const button = await this.button();
    const label = await nameOf(button);
    if (!(await pressed(button))) await (await this.rule.row(this.message)).act(SHOW);
    return count(label);
  }

  /** Presses *Show N* again, which takes the group's vertices off the page. */
  async hide(): Promise<void> {
    if (!(await pressed(await this.button()))) return;
    await (await this.rule.row(this.message)).act(SHOW);
  }

  private async button(): Promise<TestElement> {
    const row = await this.rule.row(this.message);
    return this.rule.findOne({ role: "button", name: SHOW }, "the finding has no Show", row.host);
  }
}
