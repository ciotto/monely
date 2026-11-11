import { afterEach, describe, expect, it, vi } from "vitest";

import { detectLocale, i18n, setLocale } from "@/i18n";

describe("detectLocale", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("prefers the stored locale", () => {
    localStorage.setItem("monely.locale", "it");
    expect(detectLocale()).toBe("it");
  });

  it("falls back to the browser language", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("it-IT");
    expect(detectLocale()).toBe("it");
  });

  it("defaults to english for unsupported languages", () => {
    localStorage.setItem("monely.locale", "fr");
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    expect(detectLocale()).toBe("en");
  });
});

describe("setLocale", () => {
  it("updates i18n, storage and the document language", () => {
    setLocale("it");
    expect(i18n.global.locale.value).toBe("it");
    expect(localStorage.getItem("monely.locale")).toBe("it");
    expect(document.documentElement.lang).toBe("it");
  });
});
