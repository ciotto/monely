import { reactive } from "vue";

import { apiFetch } from "@/api/client";

// `ready` becomes true once the session has been checked with the backend;
// `setupRequired` is true while no user exists, so the first one must be created
export const auth = reactive({ user: null, ready: false, setupRequired: false });

// The setup endpoint answers 404 as soon as a user exists
async function isSetupRequired() {
  try {
    await apiFetch("/setup/");
    return true;
  } catch {
    return false;
  }
}

export async function fetchUser() {
  try {
    auth.user = await apiFetch("/auth/me/");
  } catch {
    auth.user = null;
  }
  auth.setupRequired = !auth.user && (await isSetupRequired());
  auth.ready = true;
}

export async function setup(data) {
  auth.user = await apiFetch("/setup/", { method: "POST", body: data });
  auth.setupRequired = false;
}

export async function login(email, password) {
  auth.user = await apiFetch("/auth/login/", { method: "POST", body: { email, password } });
}

export async function logout() {
  await apiFetch("/auth/logout/", { method: "POST" });
  auth.user = null;
}

export async function authGuard(to) {
  if (!auth.ready) {
    await fetchUser();
  }
  if (auth.setupRequired) {
    return to.name === "setup" ? true : { name: "setup" };
  }
  if (to.name === "setup") {
    return { name: "dashboard" };
  }
  if (to.meta.public) {
    return to.name === "login" && auth.user ? { name: "dashboard" } : true;
  }
  return auth.user ? true : { name: "login", query: { next: to.fullPath } };
}
