import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import App from "@/App.vue";
import { i18n, setLocale } from "@/i18n";
import { routes } from "@/router";

async function mountAt(path) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router, i18n] } });
  await flushPromises();
  return wrapper;
}

describe("App", () => {
  beforeEach(() => setLocale("en"));

  it("renders the dashboard", async () => {
    const wrapper = await mountAt("/");
    expect(wrapper.find("h1").text()).toBe("Dashboard");
    expect(wrapper.text()).toContain("No data yet");
  });

  it("renders the not found page for unknown paths", async () => {
    const wrapper = await mountAt("/missing");
    expect(wrapper.find("h1").text()).toBe("Page not found");
  });

  it("switches language from the header", async () => {
    const wrapper = await mountAt("/");
    await wrapper.find("select").setValue("it");
    expect(i18n.global.locale.value).toBe("it");
    expect(wrapper.text()).toContain("Nessun dato ancora");
  });
});
