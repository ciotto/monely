import datetime
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.db.models import ProtectedError

from core.models import Budget, Category, Contribution, RecurringTransaction, Tag, Transaction, User, Wallet


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


@pytest.mark.django_db
class TestTransaction:
    @pytest.fixture
    def transaction(self):
        return Transaction.objects.create(
            wallet=Wallet.objects.create(name="Cash"),
            date=datetime.date(2026, 11, 12),
            amount=Decimal("-4.50"),
            description="Coffee",
            category=Category.objects.create(name="Bar"),
        )

    def test_str(self, transaction):
        assert str(transaction) == "2026-11-12 Coffee -4.50"

    def test_deleting_the_category_keeps_the_transaction(self, transaction):
        transaction.category.delete()

        transaction.refresh_from_db()
        assert transaction.category is None

    def test_wallet_with_transactions_cannot_be_deleted(self, transaction):
        with pytest.raises(ProtectedError):
            transaction.wallet.delete()


@pytest.mark.django_db
class TestBudget:
    @pytest.fixture
    def budget(self):
        return Budget.objects.create(category=Category.objects.create(name="Groceries"), amount=Decimal("300.00"))

    def test_str(self, budget):
        assert str(budget) == "Groceries 300.00 EUR"

    def test_unique_by_category_and_currency(self, budget):
        Budget.objects.create(category=budget.category, currency="USD", amount=100)

        with pytest.raises(IntegrityError):
            Budget.objects.create(category=budget.category, amount=100)

    def test_deleting_the_category_deletes_the_budget(self, budget):
        budget.category.delete()

        assert not Budget.objects.exists()


@pytest.mark.django_db
class TestContribution:
    def test_str(self):
        contribution = Contribution.objects.create(amount=Decimal("2000.00"), start_month=datetime.date(2026, 10, 1))

        assert str(contribution) == "2000.00 EUR"

    def test_unique_by_currency(self):
        Contribution.objects.create(amount=100, start_month=datetime.date(2026, 10, 1))

        with pytest.raises(IntegrityError):
            Contribution.objects.create(amount=200, start_month=datetime.date(2026, 11, 1))


@pytest.mark.parametrize(
    "frequency, interval, amount, expected",
    [
        ("monthly", 1, "-800.00", "-800.00"),
        ("monthly", 3, "-100.00", "-33.33"),
        ("yearly", 1, "-1200.00", "-100.00"),
        ("yearly", 2, "-1000.00", "-41.67"),
        # 52 weeks in 12 months
        ("weekly", 1, "-30.00", "-130.00"),
        ("weekly", 2, "-30.00", "-65.00"),
        ("monthly", 1, "1500.00", "1500.00"),
    ],
)
def test_recurring_monthly_amount(frequency, interval, amount, expected):
    recurring = RecurringTransaction(frequency=frequency, interval=interval, amount=Decimal(amount))

    assert recurring.monthly_amount == Decimal(expected)
