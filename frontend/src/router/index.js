import { createRouter, createWebHistory } from "vue-router";

import { authGuard } from "@/auth";
import DashboardView from "@/views/DashboardView.vue";
import LoginView from "@/views/LoginView.vue";
import SetupView from "@/views/SetupView.vue";
import UserFormView from "@/views/UserFormView.vue";
import UsersView from "@/views/UsersView.vue";

const routes = [
  { path: "/", name: "dashboard", component: DashboardView },
  { path: "/login", name: "login", component: LoginView, meta: { public: true } },
  { path: "/setup", name: "setup", component: SetupView },
  { path: "/users", name: "users", component: UsersView, meta: { admin: true } },
  { path: "/users/new", name: "user-new", component: UserFormView, meta: { admin: true } },
  { path: "/users/:id(\\d+)", name: "user-edit", component: UserFormView, meta: { admin: true } },
  { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("@/views/NotFoundView.vue") },
];

export function createAppRouter(history = createWebHistory()) {
  const router = createRouter({ history, routes });
  router.beforeEach(authGuard);
  return router;
}

export const router = createAppRouter();
