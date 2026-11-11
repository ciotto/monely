import { createI18n } from "vue-i18n";

import en from "@/locales/en.json";
import it from "@/locales/it.json";

export const SUPPORTED_LOCALES = ["it", "en"];
const STORAGE_KEY = "monely.locale";

export function detectLocale() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (SUPPORTED_LOCALES.includes(stored)) {
    return stored;
  }
  const browser = navigator.language.split("-")[0];
  return SUPPORTED_LOCALES.includes(browser) ? browser : "en";
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: "en",
  messages: { it, en },
});

export function setLocale(locale) {
  i18n.global.locale.value = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
}
