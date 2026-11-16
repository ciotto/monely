import datetime

import pytest
from django.urls import reverse

from core.models import BankMovement, Budget, Category, RecurringTransaction, Transaction, Transfer, User, Wallet


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

    def test_bank_movement_changelist(self, admin_client):
        BankMovement.objects.create(
            wallet=Wallet.objects.create(name="Bank"), date=datetime.date(2026, 11, 2), amount=-45, description="Coop"
        )

        response = admin_client.get(reverse("admin:core_bankmovement_changelist"))

        assert response.status_code == 200
        assert "Coop" in response.content.decode()

    def test_wallet_change(self, admin_client):
        wallet = Wallet.objects.create(name="Bank")

        response = admin_client.get(reverse("admin:core_wallet_change", args=[wallet.pk]))

        assert response.status_code == 200
        # The import format is edited with the wallet
        assert "import_format-TOTAL_FORMS" in response.content.decode()

    def test_wallet_changelist(self, admin_client):
        response = admin_client.get(reverse("admin:core_wallet_changelist"))

        assert response.status_code == 200

    def test_budget_changelist(self, admin_client):
        Budget.objects.create(category=Category.objects.create(name="Groceries"), amount=300)

        response = admin_client.get(reverse("admin:core_budget_changelist"))

        assert response.status_code == 200
        assert "Groceries" in response.content.decode()

    @pytest.mark.parametrize("model", ["category", "tag"])
    def test_label_changelist(self, admin_client, model):
        response = admin_client.get(reverse(f"admin:core_{model}_changelist"))

        assert response.status_code == 200

    def test_recurring_transaction_changelist(self, admin_client):
        response = admin_client.get(reverse("admin:core_recurringtransaction_changelist"))

        assert response.status_code == 200

    def test_transaction_changelist(self, admin_client):
        response = admin_client.get(reverse("admin:core_transaction_changelist"))

        assert response.status_code == 200

    def test_transfer_change(self, admin_client):
        transfer = Transfer.objects.create()
        Transaction.objects.create(
            transfer=transfer,
            wallet=Wallet.objects.create(name="Bank"),
            date=datetime.date(2026, 11, 1),
            amount=-1,
            description="ATM",
        )

        assert admin_client.get(reverse("admin:core_transfer_changelist")).status_code == 200
        response = admin_client.get(reverse("admin:core_transfer_change", args=[transfer.pk]))

        assert response.status_code == 200
        assert "ATM" in response.content.decode()

    def test_recurring_transaction_change(self, admin_client):
        wallet = Wallet.objects.create(name="Bank")
        recurring = RecurringTransaction.objects.create(
            wallet=wallet,
            amount=-800,
            description="Rent",
            start_date=datetime.date(2026, 11, 1),
            next_date=datetime.date(2026, 12, 1),
        )
        Transaction.objects.create(
            wallet=wallet,
            date=datetime.date(2026, 11, 3),
            amount=-800,
            description="November rent",
            recurring_transaction=recurring,
        )

        response = admin_client.get(reverse("admin:core_recurringtransaction_change", args=[recurring.pk]))

        assert response.status_code == 200
        assert "November rent" in response.content.decode()
