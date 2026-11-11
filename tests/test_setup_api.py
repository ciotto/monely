from unittest import mock

import pytest
from django.contrib.auth import SESSION_KEY
from django.urls import reverse

from core.models import User

DATA = {"email": "anna@EXAMPLE.com", "first_name": "Anna", "last_name": "Bianchi", "password": "Zx9!long-pass"}


@pytest.mark.django_db
class TestSetupView:
    url = reverse("api:setup")

    def test_setup_required(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 204

    def test_setup_not_required(self, api_client, user):
        response = api_client.get(self.url)

        assert response.status_code == 404

    def test_setup(self, api_client):
        response = api_client.post(self.url, DATA, format="json")

        assert response.status_code == 201
        user = User.objects.get()
        assert response.json() == {
            "id": user.pk,
            "email": "anna@example.com",
            "first_name": "Anna",
            "last_name": "Bianchi",
        }
        assert user.check_password("Zx9!long-pass")
        assert user.is_superuser
        assert user.is_staff
        assert api_client.session[SESSION_KEY] == str(user.pk)
        assert "csrftoken" in response.cookies

    def test_setup_only_once(self, api_client):
        api_client.post(self.url, DATA, format="json")
        api_client.logout()

        response = api_client.post(self.url, {**DATA, "email": "other@example.com"}, format="json")

        assert response.status_code == 404
        assert User.objects.count() == 1

    def test_setup_concurrent_request(self, api_client):
        # Another request creates the first user between the initial check and the table lock
        with mock.patch.object(User.objects, "exists", side_effect=[False, True]):
            response = api_client.post(self.url, DATA, format="json")

        assert response.status_code == 404
        assert not User.objects.exists()

    def test_setup_missing_fields(self, api_client):
        response = api_client.post(self.url, {}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"email", "password"}

    @pytest.mark.parametrize("password", ["short", "12345678901", "anna-bianchi"])
    def test_setup_weak_password(self, api_client, password):
        response = api_client.post(self.url, {**DATA, "password": password}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"password"}
        assert not User.objects.exists()

    def test_setup_invalid_email(self, api_client):
        response = api_client.post(self.url, {**DATA, "email": "not-an-email"}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"email"}
