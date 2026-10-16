import { type Locator, type Page, expect } from "@playwright/test";

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Fonts may not load in sandboxed CI; everything else must be error-free. */
export const realErrors = (errors: string[]) => errors.filter((e) => !/fonts\.(googleapis|gstatic)/.test(e));

export async function setName(page: Page, name: string) {
  await page.addInitScript((n) => {
    if (!localStorage.getItem("luno.lang")) localStorage.setItem("luno.lang", "en");
    const raw = localStorage.getItem("luno.identity");
    const id = raw ? JSON.parse(raw) : null;
    if (!id || id.name !== n) {
      const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("luno.identity", JSON.stringify({ pid: "p" + rnd().slice(0, 20), token: rnd() + rnd(), name: n, avatar: 3 }));
    }
  }, name);
}

export async function createRoom(page: Page, bots: number): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/r\/[A-Z0-9]{6}$/);
  const seats = page.locator(".seat-tile:not(.is-empty)");
  await expect(seats).toHaveCount(1);
  for (let i = 0; i < bots; i++) {
    await page.locator(".add-bot").first().click();
    await expect(seats).toHaveCount(i + 2);
  }
  await page.getByRole("radio", { name: "4s" }).click();
  await page.getByRole("radio", { name: "15s" }).click();
  return page.url().split("/r/")[1];
}

const tap = (l: Locator) => l.click({ timeout: 1500 }).catch(() => {});
const visible = (l: Locator) => l.isVisible().catch(() => false);

/** Plays like a casual human through the real UI until `done()` or the round ends. Returns steps taken. */
export async function autoplay(page: Page, opts: { maxSteps?: number; done?: () => Promise<boolean> } = {}) {
  const max = opts.maxSteps ?? 1500;
  for (let step = 0; step < max; step++) {
    if (opts.done && (await opts.done())) return step;
    if (await visible(page.getByTestId("round-result"))) return step;
    await page.waitForTimeout(300);
    if (await visible(page.getByTestId("reveal"))) continue;
    const commit = page.getByTestId("wlc-commit-btn");
    if (await visible(commit)) {
      await tap(page.locator('[data-testid="hand-card"][data-state="commit"]').first());
      await tap(commit);
      continue;
    }
    const slot = page.locator(".wlc-slot.is-clickable").first();
    if (await visible(slot)) {
      await tap(Math.random() < 0.5 ? slot : page.getByTestId("wlc-end-btn"));
      continue;
    }
    const trust = page.getByTestId("trust-btn");
    if (await visible(trust)) {
      await tap(Math.random() < 0.3 ? page.getByTestId("challenge-btn") : trust);
      continue;
    }
    if (await visible(page.getByTestId("uno-btn"))) await tap(page.getByTestId("uno-btn"));
    if (await visible(page.locator(".catch-btn").first())) await tap(page.locator(".catch-btn").first());
    if (await visible(page.getByTestId("play-drawn-btn"))) {
      await tap(Math.random() < 0.6 ? page.getByTestId("play-drawn-btn") : page.getByTestId("keep-btn"));
    } else if (await visible(page.getByTestId("draw-btn"))) {
      const playable = page.locator('[data-testid="hand-card"][data-state="play"], [data-testid="hand-card"][data-state="bluff"]');
      const n = await playable.count();
      if (n > 0 && Math.random() < 0.85) await tap(playable.nth(Math.floor(Math.random() * n)));
      else await tap(page.getByTestId("draw-btn"));
    }
    if (await visible(page.locator(".play-sheet"))) {
      const opts = page.locator(".claim-opt");
      if ((await opts.count()) > 0 && (await page.locator(".claim-opt.is-on").count()) === 0) {
        await tap(opts.nth(Math.floor(Math.random() * (await opts.count()))));
      }
      const sw = page.locator(".color-swatch");
      if ((await sw.count()) > 0) await tap(sw.nth(Math.floor(Math.random() * 4)));
      const tg = page.locator(".target");
      if ((await tg.count()) > 0) await tap(tg.first());
      if (await visible(page.getByTestId("sheet-confirm"))) await tap(page.getByTestId("sheet-confirm"));
    }
  }
  return max;
}
