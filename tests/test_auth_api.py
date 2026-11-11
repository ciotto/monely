import pytest
from django.contrib.auth import SESSION_KEY
from django.core.cache import cache
from django.urls import reverse


@pytest.mark.django_db
class TestLoginView:
    url = reverse("api:login")

    @pytest.fixture(autouse=True)
    def clear_throttle_cache(self):
        cache.clear()
        yield
        cache.clear()

    def test_login(self, api_client, user):
        response = api_client.post(self.url, {"email": "mario@example.com", "password": "secret-pass"}, format="json")

        assert response.status_code == 200
        assert response.json() == {
            "id": user.pk,
            "email": "mario@example.com",
            "first_name": "Mario",
            "last_name": "Rossi",
        }
        assert api_client.session[SESSION_KEY] == str(user.pk)
        assert "csrftoken" in response.cookies

    @pytest.mark.parametrize(
        "email,password",
        [("mario@example.com", "wrong-pass"), ("luigi@example.com", "secret-pass")],
    )
    def test_login_with_wrong_credentials(self, api_client, user, email, password):
        response = api_client.post(self.url, {"email": email, "password": password}, format="json")

        assert response.status_code == 400
        assert response.json() == {"non_field_errors": ["Invalid email or password."]}
        assert SESSION_KEY not in api_client.session

    def test_login_inactive_user(self, api_client, user):
        user.is_active = False
        user.save()

        response = api_client.post(self.url, {"email": "mario@example.com", "password": "secret-pass"}, format="json")

        assert response.status_code == 400
        assert SESSION_KEY not in api_client.session

    def test_login_missing_fields(self, api_client):
        response = api_client.post(self.url, {}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"email", "password"}

    def test_login_get_not_allowed(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 405

    def test_login_is_throttled(self, api_client, user):
        for _ in range(10):
            api_client.post(self.url, {"email": "mario@example.com", "password": "wrong-pass"}, format="json")

        response = api_client.post(self.url, {"email": "mario@example.com", "password": "secret-pass"}, format="json")

        assert response.status_code == 429


@pytest.mark.django_db
class TestLogoutView:
    url = reverse("api:logout")

    def test_logout(self, api_client, user):
        api_client.force_login(user)
        csrf_token = api_client.get(reverse("api:me")).cookies["csrftoken"].value

        response = api_client.post(self.url, HTTP_X_CSRFTOKEN=csrf_token)

        assert response.status_code == 204
        assert SESSION_KEY not in api_client.session

    def test_logout_without_csrf_token(self, api_client, user):
        api_client.force_login(user)

        response = api_client.post(self.url)

        assert response.status_code == 403
        assert api_client.session[SESSION_KEY] == str(user.pk)

    def test_logout_anonymous(self, api_client):
        response = api_client.post(self.url)

        assert response.status_code == 204


@pytest.mark.django_db
class TestMeView:
    url = reverse("api:me")

    def test_me(self, api_client, user):
        api_client.force_login(user)

        response = api_client.get(self.url)

        assert response.status_code == 200
        assert response.json() == {
            "id": user.pk,
            "email": "mario@example.com",
            "first_name": "Mario",
            "last_name": "Rossi",
        }

    def test_me_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403
        assert "csrftoken" in response.cookies
