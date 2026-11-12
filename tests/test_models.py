import pytest
from django.db import IntegrityError

from core.models import Category, Tag, User, Wallet


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


@pytest.mark.django_db
class TestWallet:
    def test_defaults(self):
        wallet = Wallet.objects.create(name="Cash")

        assert wallet.currency == "EUR"
        assert not wallet.is_archived
        assert str(wallet) == "Cash"


@pytest.mark.django_db
@pytest.mark.parametrize("model", [Category, Tag])
class TestLabel:
    def test_str(self, model):
        assert str(model.objects.create(name="Groceries")) == "Groceries"

    def test_name_unique_regardless_of_case(self, model):
        model.objects.create(name="Groceries")

        with pytest.raises(IntegrityError):
            model.objects.create(name="groceries")
