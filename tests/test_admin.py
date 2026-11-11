import pytest
from django.urls import reverse

from core.models import User


@pytest.mark.django_db
class TestUserAdmin:
    @pytest.fixture
    def admin_client(self, client):
        client.force_login(User.objects.create_superuser("admin@example.com", "secret-pass"))
        return client

    def test_changelist(self, admin_client):
        response = admin_client.get(reverse("admin:core_user_changelist"))

        assert response.status_code == 200

    def test_add_user(self, admin_client):
        response = admin_client.post(
            reverse("admin:core_user_add"),
            {
                "email": "new@example.com",
                "usable_password": "true",
                "password1": "Zx9!long-pass",
                "password2": "Zx9!long-pass",
            },
        )

        assert response.status_code == 302
        assert User.objects.get(email="new@example.com").check_password("Zx9!long-pass")
