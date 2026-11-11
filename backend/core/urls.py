from django.urls import path

from core.views import LoginView

app_name = "api"

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="login"),
]
