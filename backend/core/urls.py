from django.urls import path

from core.views import (
    LoginView,
    LogoutView,
    MeView,
    SetupView,
    UserDetailView,
    UserListView,
    WalletDetailView,
    WalletListView,
    WalletOwnerListView,
)

app_name = "api"

urlpatterns = [
    path("setup/", SetupView.as_view(), name="setup"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("users/", UserListView.as_view(), name="users"),
    path("users/<int:pk>/", UserDetailView.as_view(), name="user"),
    path("wallets/", WalletListView.as_view(), name="wallets"),
    path("wallets/owners/", WalletOwnerListView.as_view(), name="wallet-owners"),
    path("wallets/<int:pk>/", WalletDetailView.as_view(), name="wallet"),
]
