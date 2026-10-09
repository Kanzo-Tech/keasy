import type { Locator, Mouse, Page } from "@playwright/test";

/** How long the cursor glides to a target before the action lands there. */
export const GLIDE = 550;

/**
 * The cursor, drawn by the page itself from the real input events Playwright sends: an arrow that
 * glides to each point and a ring where a button goes down. Nothing but the pointer moves it, so it
 * is where the click is. An init script: `context.addInitScript(CURSOR, GLIDE)`.
 */
export const CURSOR = (glide: number) => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML =
      '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2l0 19 5-4.5 3.4 7.3 3.3-1.5-3.3-7.1 6.8-.4z" fill="#0c100d" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate(-100px,-100px)",
      transition: `transform ${glide - 80}ms cubic-bezier(.3,.7,.2,1)`,
      filter: "drop-shadow(0 2px 3px rgba(0,0,0,.3))",
    });
    document.documentElement.appendChild(cursor);
    let down = false;
    addEventListener(
      "mousemove",
      (e) => {
        cursor.style.transition = down ? "transform 40ms linear" : `transform ${glide - 80}ms cubic-bezier(.3,.7,.2,1)`;
        cursor.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 2}px)`;
      },
      true,
    );
    addEventListener(
      "mousedown",
      (e) => {
        down = true;
        const ring = document.createElement("div");
        Object.assign(ring.style, {
          position: "fixed",
          left: `${e.clientX - 18}px`,
          top: `${e.clientY - 18}px`,
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          border: "2.5px solid #1ae973",
          background: "rgba(26,233,115,.18)",
          zIndex: "2147483646",
          pointerEvents: "none",
          transform: "scale(.4)",
          opacity: "1",
          transition: "transform 450ms ease-out, opacity 450ms ease-out",
        });
        document.documentElement.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.transform = "scale(1.4)";
          ring.style.opacity = "0";
        });
        setTimeout(() => ring.remove(), 600);
      },
      true,
    );
    addEventListener(
      "mouseup",
      () => {
        down = false;
      },
      true,
    );
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

/**
 * While a demo records, every click, hover and drag first moves the pointer to its target and waits
 * out the glide, so the cursor arrives before the page answers. Patched on Locator's prototype for
 * the length of `run`, and put back.
 *
 * `page.mouse` is wrapped the same way, for the drags a locator cannot name (a lasso, a brush drawn
 * point by point): a move with no button held waits out the glide once the pointer is sent, so the
 * press that follows lands where the cursor is; a move with a button held is the drag itself, which
 * the cursor follows at once.
 */
export async function gliding<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const proto = Object.getPrototypeOf(page.locator("body")) as Locator;
  const { click, dragTo } = proto;
  const arrive = async (target: Locator, position?: { x: number; y: number }) => {
    await target.hover({ position });
    await page.waitForTimeout(GLIDE);
  };
  proto.click = async function (this: Locator, options?: Parameters<Locator["click"]>[0]) {
    await arrive(this, options?.position);
    return click.call(this, options);
  };
  proto.dragTo = async function (this: Locator, target: Locator, options?: Parameters<Locator["dragTo"]>[1]) {
    await arrive(this, options?.sourcePosition);
    return dragTo.call(this, target, options);
  };

  const mouse = page.mouse;
  const KEYS = ["move", "down", "up"] as const;
  // Whatever the mouse holds as its own (nothing, when the methods are its class's), put back after.
  const own = KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(mouse, key)] as const);
  const { move, down, up } = { move: mouse.move.bind(mouse), down: mouse.down.bind(mouse), up: mouse.up.bind(mouse) };
  let held = false;
  const patched: Pick<Mouse, "move" | "down" | "up"> = {
    async move(x, y, options) {
      await move(x, y, options);
      if (!held) await page.waitForTimeout(GLIDE);
    },
    async down(options) {
      held = true;
      await down(options);
    },
    async up(options) {
      await up(options);
      held = false;
    },
  };
  Object.assign(mouse, patched);

  try {
    return await run();
  } finally {
    Object.assign(proto, { click, dragTo });
    for (const [key, descriptor] of own) {
      if (descriptor) Object.defineProperty(mouse, key, descriptor);
      else delete (mouse as Partial<Mouse>)[key];
    }
  }
}
