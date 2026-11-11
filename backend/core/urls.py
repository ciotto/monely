from django.urls import path

from core.views import LoginView, LogoutView, MeView, SetupView, UserListView

app_name = "api"

urlpatterns = [
    path("setup/", SetupView.as_view(), name="setup"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("users/", UserListView.as_view(), name="users"),
]
