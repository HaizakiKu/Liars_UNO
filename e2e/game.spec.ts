import { expect, test } from "@playwright/test";
import { autoplay, createRoom, realErrors, setName, trackErrors } from "./helpers";

test("home page renders and switches language", async ({ page }) => {
  const errors = trackErrors(page);
  await setName(page, "Tester");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Liar's/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public rooms" })).toBeVisible();
  await page.getByRole("button", { name: "中文" }).click();
  await expect(page.getByRole("heading", { name: "公开房间" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Public rooms" })).toBeVisible();
  expect(realErrors(errors)).toEqual([]);
});

test("a full round against bots through the UI", async ({ page }) => {
  const errors = trackErrors(page);
  await setName(page, "Solo");
  test.setTimeout(480_000);
  await createRoom(page, 3);
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByTestId("hand-card").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("deck")).toBeVisible();
  await autoplay(page);
  await expect(page.getByTestId("round-result")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("next-round-btn").click();
  await expect(page.getByRole("button", { name: "Start game" })).toBeVisible();
  expect(realErrors(errors)).toEqual([]);
});

test("two humans: invite link, spectator, reconnect after reload, leave → bot takes over", async ({ browser }) => {
  test.setTimeout(600_000);
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  const watcher = await (await browser.newContext()).newPage();
  const errors = [...[host, guest, watcher].map(trackErrors)];
  await setName(host, "Host");
  await setName(guest, "Guest");
  await setName(watcher, "Watcher");

  const code = await createRoom(host, 1);
  await guest.goto(`/r/${code}`);
  await expect(host.locator(".seat-tile:not(.is-empty)")).toHaveCount(3);
  await expect(guest.locator(".seat-tile.is-me")).toBeVisible();
  await expect(guest.getByText("Waiting for the host to start…")).toBeVisible();

  // Guest can't start; host starts.
  await host.getByRole("button", { name: "Start game" }).click();
  await expect(host.getByTestId("hand-card").first()).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByTestId("hand-card").first()).toBeVisible({ timeout: 15_000 });

  // Late joiner spectates without a hand.
  await watcher.goto(`/r/${code}`);
  await expect(watcher.getByText("Spectating")).toBeVisible();
  await expect(watcher.getByTestId("hand-card")).toHaveCount(0);

  // Guest reloads mid-game and gets the same seat back with a hand.
  const countBefore = await guest.getByTestId("hand-card").count();
  await guest.reload();
  await expect(guest.getByTestId("hand-card").first()).toBeVisible({ timeout: 15_000 });
  expect(Math.abs((await guest.getByTestId("hand-card").count()) - countBefore)).toBeLessThanOrEqual(6);

  // Both humans play for a while.
  await Promise.all([autoplay(host, { maxSteps: 40 }), autoplay(guest, { maxSteps: 40 })]);

  // Guest leaves: the seat stays, marked as auto-played, and the game keeps going.
  await guest.getByRole("button", { name: "Leave" }).click();
  await guest.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  await expect(guest).toHaveURL(/\/$/);
  await expect(host.getByTestId("seat-Guest").getByText("AUTO")).toBeVisible({ timeout: 10_000 });
  await autoplay(host);
  await expect(host.getByTestId("round-result")).toBeVisible({ timeout: 30_000 });
  for (const e of errors) expect(realErrors(e)).toEqual([]);
});
