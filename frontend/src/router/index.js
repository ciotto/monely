import { createRouter, createWebHistory } from "vue-router";

import { authGuard } from "@/auth";
import DashboardView from "@/views/DashboardView.vue";
import LabelsView from "@/views/LabelsView.vue";
import LoginView from "@/views/LoginView.vue";
import MaintenanceView from "@/views/MaintenanceView.vue";
import RecurringFormView from "@/views/RecurringFormView.vue";
import RecurringView from "@/views/RecurringView.vue";
import SetupView from "@/views/SetupView.vue";
import TransactionFormView from "@/views/TransactionFormView.vue";
import TransactionsView from "@/views/TransactionsView.vue";
import TransferFormView from "@/views/TransferFormView.vue";
import UserFormView from "@/views/UserFormView.vue";
import UsersView from "@/views/UsersView.vue";
import WalletFormView from "@/views/WalletFormView.vue";
import WalletsView from "@/views/WalletsView.vue";

const routes = [
  { path: "/", name: "dashboard", component: DashboardView },
  { path: "/login", name: "login", component: LoginView, meta: { public: true } },
  { path: "/setup", name: "setup", component: SetupView },
  { path: "/transactions", name: "transactions", component: TransactionsView },
  { path: "/transactions/new", name: "transaction-new", component: TransactionFormView },
  { path: "/transactions/:id(\\d+)", name: "transaction-edit", component: TransactionFormView },
  { path: "/transfers/new", name: "transfer-new", component: TransferFormView },
  { path: "/transfers/:id(\\d+)", name: "transfer-edit", component: TransferFormView },
  { path: "/recurring", name: "recurring", component: RecurringView, meta: { settings: true } },
  { path: "/recurring/new", name: "recurring-new", component: RecurringFormView, meta: { settings: true } },
  { path: "/recurring/:id(\\d+)", name: "recurring-edit", component: RecurringFormView, meta: { settings: true } },
  { path: "/wallets", name: "wallets", component: WalletsView, meta: { settings: true } },
  { path: "/wallets/new", name: "wallet-new", component: WalletFormView, meta: { settings: true } },
  { path: "/wallets/:id(\\d+)", name: "wallet-edit", component: WalletFormView, meta: { settings: true } },
  {
    path: "/categories",
    name: "categories",
    component: LabelsView,
    props: { resource: "categories", withIcon: true },
    meta: { settings: true },
  },
  { path: "/tags", name: "tags", component: LabelsView, props: { resource: "tags" }, meta: { settings: true } },
  { path: "/users", name: "users", component: UsersView, meta: { admin: true, settings: true } },
  { path: "/users/new", name: "user-new", component: UserFormView, meta: { admin: true, settings: true } },
  { path: "/users/:id(\\d+)", name: "user-edit", component: UserFormView, meta: { admin: true, settings: true } },
  { path: "/maintenance", name: "maintenance", component: MaintenanceView, meta: { admin: true, settings: true } },
  { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("@/views/NotFoundView.vue") },
];

export function createAppRouter(history = createWebHistory()) {
  const router = createRouter({ history, routes });
  router.beforeEach(authGuard);
  return router;
}

export const router = createAppRouter();
