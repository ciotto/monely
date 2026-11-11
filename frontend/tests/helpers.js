import { vi } from "vitest";

export const USER = { id: 1, email: "anna@example.com", first_name: "Anna", last_name: "" };

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
