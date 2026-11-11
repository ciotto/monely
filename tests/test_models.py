import pytest

from core.models import User


@pytest.mark.django_db
class TestUserManager:
    def test_create_user(self):
        user = User.objects.create_user("Mario@Example.COM", "secret-pass")

        assert user.email == "Mario@example.com"
        assert user.check_password("secret-pass")
        assert not user.is_staff
        assert not user.is_superuser
        assert str(user) == "Mario@example.com"

    def test_create_user_without_email(self):
        with pytest.raises(ValueError):
            User.objects.create_user("", "secret-pass")

    def test_create_superuser(self):
        user = User.objects.create_superuser("admin@example.com", "secret-pass")

        assert user.is_staff
        assert user.is_superuser

    @pytest.mark.parametrize("field", ["is_staff", "is_superuser"])
    def test_create_superuser_with_wrong_flags(self, field):
        with pytest.raises(ValueError):
            User.objects.create_superuser("admin@example.com", "secret-pass", **{field: False})
