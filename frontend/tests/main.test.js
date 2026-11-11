import { flushPromises } from "@vue/test-utils";
import { expect, it } from "vitest";

it("mounts the app on #app", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await import("@/main.js");
  await flushPromises();
  expect(document.querySelector("header").textContent).toContain("Monely");
});
