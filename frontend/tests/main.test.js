import { flushPromises } from "@vue/test-utils";
import { expect, it } from "vitest";

import { mockFetch } from "./helpers";

it("mounts the app on #app", async () => {
  mockFetch({ "GET /api/auth/me/": [403, {}] });
  document.body.innerHTML = '<div id="app"></div>';
  await import("@/main.js");
  await flushPromises();
  expect(document.querySelector("header").textContent).toContain("Monely");
});
