import datetime

import pytest
from django.urls import reverse

from core.models import Budget, Category, Contribution, RecurringTransaction, Tag, Transaction, Transfer, User, Wallet

EMPTY = {
    "transactions": 0,
    "transfers": 0,
    "recurring_transactions": 0,
    "wallets": 0,
    "budgets": 0,
    "contributions": 0,
    "categories": 0,
    "tags": 0,
}


@pytest.fixture
def admin_client(api_client):
    api_client.force_login(User.objects.create_superuser("admin@example.com", "secret-pass"))
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def data(user):
    bank = Wallet.objects.create(name="Bank")
    bank.owners.add(user)
    cash = Wallet.objects.create(name="Cash", is_archived=True)
    tag = Tag.objects.create(name="car")
    category = Category.objects.create(name="Transport")
    Budget.objects.create(category=category, amount=100)
    Contribution.objects.create(amount=1000, start_month=datetime.date(2026, 11, 1))
    item = Transaction.objects.create(
        wallet=bank, date=datetime.date(2026, 11, 1), amount=-10, description="Fuel", category=category
    )
    item.tags.add(tag)
    transfer = Transfer.objects.create()
    for wallet, amount in ((bank, -50), (cash, 50)):
        Transaction.objects.create(
            wallet=wallet, date=datetime.date(2026, 11, 2), amount=amount, description="ATM", transfer=transfer
        )
    recurring = RecurringTransaction.objects.create(
        wallet=bank,
        amount=-800,
        description="Rent",
        start_date=datetime.date(2026, 11, 1),
        next_date=datetime.date(2026, 12, 1),
    )
    recurring.tags.add(tag)


@pytest.mark.django_db
class TestMaintenanceDataView:
    url = reverse("api:maintenance-data")

    def test_count(self, admin_client, data):
        response = admin_client.get(self.url)

        assert response.status_code == 200
        assert response.json() == {
            "transactions": 3,
            "transfers": 1,
            "recurring_transactions": 1,
            "wallets": 2,
            "budgets": 1,
            "contributions": 1,
            "categories": 1,
            "tags": 1,
        }

    def test_delete(self, admin_client, user, data):
        response = admin_client.delete(self.url)

        assert response.status_code == 200
        assert response.json() == {
            "transactions": 3,
            "transfers": 1,
            "recurring_transactions": 1,
            "wallets": 2,
            "budgets": 1,
            "contributions": 1,
            "categories": 1,
            "tags": 1,
        }
        assert admin_client.get(self.url).json() == EMPTY
        # The users are kept
        assert User.objects.count() == 2

    def test_delete_empty(self, admin_client):
        response = admin_client.delete(self.url)

        assert response.json() == EMPTY

    def test_delete_without_csrf_token(self, api_client, data):
        api_client.force_login(User.objects.create_superuser("admin@example.com", "secret-pass"))

        response = api_client.delete(self.url)

        assert response.status_code == 403
        assert Transaction.objects.exists()

    @pytest.mark.parametrize("method", ["get", "delete"])
    def test_not_admin(self, api_client, user, data, method):
        api_client.force_login(user)
        api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)

        response = getattr(api_client, method)(self.url)

        assert response.status_code == 403
        assert Transaction.objects.count() == 3

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403
