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
