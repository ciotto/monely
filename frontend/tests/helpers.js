import { flushPromises, mount } from "@vue/test-utils";
import { vi } from "vitest";
import { createMemoryHistory } from "vue-router";

import App from "@/App.vue";
import { i18n } from "@/i18n";
import { createAppRouter } from "@/router";

export const USER = { id: 1, email: "anna@example.com", first_name: "Anna", last_name: "", is_staff: false };
export const ADMIN = { ...USER, is_staff: true };

// Stubs `fetch` with responses keyed by "METHOD /url": [status, data]; data undefined means an empty body
export function mockFetch(responses) {
  const fetch = vi.fn(async (url, { method }) => {
    const [status, data] = responses[`${method} ${url}`] ?? [404, { detail: "Not found." }];
    return {
      ok: status < 400,
      status,
      json: async () => {
        if (data === undefined) {
          throw new SyntaxError("Unexpected end of JSON input");
        }
        return data;
      },
    };
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

// A page of a paginated list; `next` is the URL of the following page, null on the last one
export function page(results, next = null) {
  return { count: results.length, next, previous: null, results };
}

export async function mountAt(path, options = {}) {
  const router = createAppRouter(createMemoryHistory());
  router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router, i18n] }, ...options });
  await flushPromises();
  return { wrapper, router };
}
