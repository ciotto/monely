import { createRouter, createWebHistory } from "vue-router";

import DashboardView from "@/views/DashboardView.vue";

export const routes = [
  { path: "/", name: "dashboard", component: DashboardView },
  { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("@/views/NotFoundView.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
