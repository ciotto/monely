import pytest
from django.urls import reverse

from core.models import User


@pytest.mark.django_db
class TestUserListView:
    url = reverse("api:users")

    def test_list(self, api_client, user):
        admin = User.objects.create_superuser("admin@example.com", "secret-pass")
        api_client.force_login(admin)

        response = api_client.get(self.url)

        assert response.status_code == 200
        admin.refresh_from_db()
        assert response.json() == [
            {
                "id": admin.pk,
                "email": "admin@example.com",
                "first_name": "",
                "last_name": "",
                "is_staff": True,
                "is_active": True,
                "date_joined": admin.date_joined.isoformat().replace("+00:00", "Z"),
                "last_login": admin.last_login.isoformat().replace("+00:00", "Z"),
            },
            {
                "id": user.pk,
                "email": "mario@example.com",
                "first_name": "Mario",
                "last_name": "Rossi",
                "is_staff": False,
                "is_active": True,
                "date_joined": user.date_joined.isoformat().replace("+00:00", "Z"),
                "last_login": None,
            },
        ]

    def test_list_not_admin(self, api_client, user):
        api_client.force_login(user)

        response = api_client.get(self.url)

        assert response.status_code == 403

    def test_list_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403


@pytest.fixture
def admin():
    return User.objects.create_superuser("admin@example.com", "secret-pass")


@pytest.fixture
def admin_client(api_client, admin):
    api_client.force_login(admin)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.mark.django_db
class TestUserCreate:
    url = reverse("api:users")
    data = {"email": "luca@EXAMPLE.com", "first_name": "Luca", "last_name": "Verdi", "password": "Zx9!long-pass"}

    def test_create(self, admin_client):
        response = admin_client.post(self.url, self.data, format="json")

        assert response.status_code == 201
        user = User.objects.get(email="luca@example.com")
        assert response.json()["id"] == user.pk
        assert "password" not in response.json()
        assert user.check_password("Zx9!long-pass")
        assert user.is_active
        assert not user.is_staff
        assert not user.is_superuser

    def test_create_admin(self, admin_client):
        response = admin_client.post(self.url, {**self.data, "is_staff": True}, format="json")

        assert response.status_code == 201
        user = User.objects.get(email="luca@example.com")
        assert user.is_staff
        assert user.is_superuser

    def test_create_without_password(self, admin_client):
        response = admin_client.post(self.url, {"email": "luca@example.com"}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"password"}

    def test_create_weak_password(self, admin_client):
        response = admin_client.post(self.url, {**self.data, "password": "password123"}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"password"}

    def test_create_duplicate_email(self, admin_client):
        response = admin_client.post(self.url, {**self.data, "email": "admin@example.com"}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"email"}

    def test_create_not_admin(self, api_client, user):
        api_client.force_login(user)

        response = api_client.post(self.url, self.data, format="json")

        assert response.status_code == 403


@pytest.mark.django_db
class TestUserDetail:
    @staticmethod
    def url(user):
        return reverse("api:user", args=[user.pk])

    def test_retrieve(self, admin_client, user):
        response = admin_client.get(self.url(user))

        assert response.status_code == 200
        assert response.json()["email"] == "mario@example.com"

    def test_update(self, admin_client, user):
        response = admin_client.patch(
            self.url(user), {"first_name": "Marco", "is_staff": True, "is_active": False}, format="json"
        )

        assert response.status_code == 200
        user.refresh_from_db()
        assert user.first_name == "Marco"
        assert user.is_staff
        assert user.is_superuser
        assert not user.is_active
        assert user.check_password("secret-pass")

    def test_update_password(self, admin_client, user):
        response = admin_client.patch(self.url(user), {"password": "Zx9!new-pass"}, format="json")

        assert response.status_code == 200
        user.refresh_from_db()
        assert user.check_password("Zx9!new-pass")

    def test_update_weak_password(self, admin_client, user):
        response = admin_client.patch(self.url(user), {"password": "12345678"}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"password"}

    def test_update_own_password_keeps_the_session(self, admin_client, admin):
        response = admin_client.patch(self.url(admin), {"password": "Zx9!new-pass"}, format="json")

        assert response.status_code == 200
        assert admin_client.get(reverse("api:me")).status_code == 200

    def test_update_own_account(self, admin_client, admin):
        response = admin_client.put(
            self.url(admin),
            {"email": "boss@example.com", "first_name": "Boss", "last_name": "", "is_staff": True, "is_active": True},
            format="json",
        )

        assert response.status_code == 200
        admin.refresh_from_db()
        assert admin.email == "boss@example.com"

    def test_update_own_role_and_status(self, admin_client, admin):
        response = admin_client.patch(self.url(admin), {"is_staff": False, "is_active": False}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"is_staff", "is_active"}
        admin.refresh_from_db()
        assert admin.is_staff
        assert admin.is_active

    def test_delete(self, admin_client, user):
        response = admin_client.delete(self.url(user))

        assert response.status_code == 204
        assert not User.objects.filter(pk=user.pk).exists()

    def test_delete_own_account(self, admin_client, admin):
        response = admin_client.delete(self.url(admin))

        assert response.status_code == 403
        assert response.json() == {"detail": "You cannot delete your own account."}
        assert User.objects.filter(pk=admin.pk).exists()

    def test_not_admin(self, api_client, user):
        api_client.force_login(user)

        response = api_client.get(self.url(user))

        assert response.status_code == 403
