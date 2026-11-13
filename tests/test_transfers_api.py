import datetime
from decimal import Decimal

import pytest
from django.urls import reverse

from core.models import Transaction, Transfer, Wallet


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def bank():
    return Wallet.objects.create(name="Bank")


@pytest.fixture
def cash():
    return Wallet.objects.create(name="Cash")


def create_transfer(from_wallet, to_wallet, amount="50.00", description="Withdrawal", notes=""):
    transfer = Transfer.objects.create()
    for wallet, sign in ((from_wallet, -1), (to_wallet, 1)):
        Transaction.objects.create(
            transfer=transfer,
            wallet=wallet,
            date=datetime.date(2026, 11, 10),
            amount=sign * Decimal(amount),
            description=description,
            notes=notes,
        )
    return transfer


def legs(transfer):
    """The wallet and the amount of the outgoing and the incoming transaction."""
    return [(item.wallet, item.amount) for item in transfer.transactions.order_by("amount")]


@pytest.mark.django_db
class TestTransferCreate:
    url = reverse("api:transfers")

    def test_create(self, user_client, bank, cash):
        response = user_client.post(
            self.url,
            {
                "from_wallet": bank.pk,
                "to_wallet": cash.pk,
                "date": "2026-11-12",
                "amount": "200",
                "description": "ATM",
                "notes": "Holiday money",
            },
            format="json",
        )

        assert response.status_code == 201
        transfer = Transfer.objects.get()
        assert response.json() == {
            "id": transfer.pk,
            "from_wallet": bank.pk,
            "to_wallet": cash.pk,
            "date": "2026-11-12",
            "amount": "200.00",
            "description": "ATM",
            "notes": "Holiday money",
            "created_at": transfer.created_at.isoformat().replace("+00:00", "Z"),
        }
        assert legs(transfer) == [(bank, Decimal("-200.00")), (cash, Decimal("200.00"))]
        for item in transfer.transactions.all():
            assert (item.date, item.description, item.notes, item.category) == (
                datetime.date(2026, 11, 12),
                "ATM",
                "Holiday money",
                None,
            )

    def test_create_without_notes(self, user_client, bank, cash):
        response = user_client.post(
            self.url,
            {"from_wallet": bank.pk, "to_wallet": cash.pk, "date": "2026-11-12", "amount": "1", "description": "ATM"},
            format="json",
        )

        assert response.status_code == 201
        assert set(Transaction.objects.values_list("notes", flat=True)) == {""}

    def test_create_missing_fields(self, user_client):
        response = user_client.post(self.url, {}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"from_wallet", "to_wallet", "date", "amount", "description"}

    @pytest.mark.parametrize("amount", ["0", "-10", "abc", "1.234"])
    def test_create_invalid_amount(self, user_client, bank, cash, amount):
        response = user_client.post(
            self.url,
            {"from_wallet": bank.pk, "to_wallet": cash.pk, "date": "2026-11-12", "amount": amount, "description": "x"},
            format="json",
        )

        assert response.status_code == 400
        assert set(response.json()) == {"amount"}

    def test_create_same_wallet(self, user_client, bank):
        response = user_client.post(
            self.url,
            {"from_wallet": bank.pk, "to_wallet": bank.pk, "date": "2026-11-12", "amount": "1", "description": "x"},
            format="json",
        )

        assert response.status_code == 400
        assert response.json() == {"to_wallet": ["Choose a wallet different from the source one."]}

    def test_create_different_currencies(self, user_client, bank):
        dollars = Wallet.objects.create(name="US account", currency="USD")

        response = user_client.post(
            self.url,
            {"from_wallet": bank.pk, "to_wallet": dollars.pk, "date": "2026-11-12", "amount": "1", "description": "x"},
            format="json",
        )

        assert response.status_code == 400
        assert response.json() == {"to_wallet": ["The wallets must use the same currency."]}

    def test_create_on_archived_wallets(self, user_client):
        old = Wallet.objects.create(name="Old", is_archived=True)
        older = Wallet.objects.create(name="Older", is_archived=True)

        response = user_client.post(
            self.url,
            {"from_wallet": old.pk, "to_wallet": older.pk, "date": "2026-11-12", "amount": "1", "description": "x"},
            format="json",
        )

        assert response.status_code == 400
        assert response.json() == {
            "from_wallet": ["This wallet is archived."],
            "to_wallet": ["This wallet is archived."],
        }
        assert not Transaction.objects.exists()

    def test_create_anonymous(self, api_client):
        response = api_client.post(self.url, {}, format="json")

        assert response.status_code == 403


@pytest.mark.django_db
class TestTransferDetail:
    @staticmethod
    def url(transfer):
        return reverse("api:transfer", args=[transfer.pk])

    def test_retrieve(self, user_client, bank, cash):
        transfer = create_transfer(bank, cash, notes="Rent")

        response = user_client.get(self.url(transfer))

        assert response.status_code == 200
        assert response.json() == {
            "id": transfer.pk,
            "from_wallet": bank.pk,
            "to_wallet": cash.pk,
            "date": "2026-11-10",
            "amount": "50.00",
            "description": "Withdrawal",
            "notes": "Rent",
            "created_at": transfer.created_at.isoformat().replace("+00:00", "Z"),
        }

    def test_update(self, user_client, bank, cash):
        transfer = create_transfer(bank, cash)
        card = Wallet.objects.create(name="Card")

        response = user_client.put(
            self.url(transfer),
            {
                "from_wallet": card.pk,
                "to_wallet": bank.pk,
                "date": "2026-11-11",
                "amount": "75.5",
                "description": "Top up",
                "notes": "Fixed",
            },
            format="json",
        )

        assert response.status_code == 200
        assert response.json()["from_wallet"] == card.pk
        assert response.json()["amount"] == "75.50"
        # The transactions are updated, not replaced
        assert Transaction.objects.count() == 2
        assert legs(transfer) == [(card, Decimal("-75.50")), (bank, Decimal("75.50"))]
        assert set(transfer.transactions.values_list("date", "description", "notes")) == {
            (datetime.date(2026, 11, 11), "Top up", "Fixed")
        }

    def test_partial_update(self, user_client, bank, cash):
        transfer = create_transfer(bank, cash, notes="Rent")

        response = user_client.patch(self.url(transfer), {"amount": "60"}, format="json")

        assert response.status_code == 200
        assert legs(transfer) == [(bank, Decimal("-60.00")), (cash, Decimal("60.00"))]
        assert set(transfer.transactions.values_list("description", "notes")) == {("Withdrawal", "Rent")}

    def test_partial_update_same_wallet(self, user_client, bank, cash):
        transfer = create_transfer(bank, cash)

        response = user_client.patch(self.url(transfer), {"to_wallet": bank.pk}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"to_wallet"}

    def test_update_on_archived_wallets(self, user_client, bank, cash):
        # Transfers of an archived wallet can still be fixed, but cannot move to another archived wallet
        transfer = create_transfer(bank, cash)
        bank.is_archived = True
        bank.save()
        old = Wallet.objects.create(name="Old", is_archived=True)

        response = user_client.patch(self.url(transfer), {"amount": "10"}, format="json")
        assert response.status_code == 200

        response = user_client.patch(self.url(transfer), {"to_wallet": old.pk}, format="json")
        assert response.status_code == 400
        assert response.json() == {"to_wallet": ["This wallet is archived."]}

    def test_delete(self, user_client, bank, cash):
        transfer = create_transfer(bank, cash)
        other = Transaction.objects.create(wallet=bank, date=datetime.date(2026, 11, 1), amount=-1, description="x")

        response = user_client.delete(self.url(transfer))

        assert response.status_code == 204
        assert not Transfer.objects.exists()
        assert list(Transaction.objects.all()) == [other]

    def test_anonymous(self, api_client, bank, cash):
        response = api_client.get(self.url(create_transfer(bank, cash)))

        assert response.status_code == 403


@pytest.mark.django_db
class TestTransferTransactions:
    def test_listed_with_the_transfer(self, user_client, bank, cash):
        transfer = create_transfer(bank, cash)

        response = user_client.get(reverse("api:transactions"))

        assert [(item["wallet"], item["amount"], item["transfer"]) for item in response.json()["results"]] == [
            (cash.pk, "50.00", transfer.pk),
            (bank.pk, "-50.00", transfer.pk),
        ]

    def test_cannot_update(self, user_client, bank, cash):
        item = create_transfer(bank, cash).transactions.first()

        response = user_client.patch(reverse("api:transaction", args=[item.pk]), {"amount": "-1"}, format="json")

        assert response.status_code == 400
        assert response.json() == {
            "non_field_errors": ["This transaction belongs to a transfer: edit the transfer instead."]
        }

    def test_cannot_delete(self, user_client, bank, cash):
        item = create_transfer(bank, cash).transactions.first()

        response = user_client.delete(reverse("api:transaction", args=[item.pk]))

        assert response.status_code == 400
        assert response.json() == ["This transaction belongs to a transfer: edit the transfer instead."]
        assert Transaction.objects.count() == 2

    def test_dashboard(self, user_client, bank, cash):
        # Transfers are neither income nor expenses, but they move the balances
        create_transfer(bank, cash)
        Transaction.objects.create(wallet=bank, date=datetime.date(2026, 11, 1), amount=100, description="Pay")

        response = user_client.get(reverse("api:dashboard"), {"month": "2026-11", "wallet": cash.pk})
        assert response.json()["currencies"][0]["income"] == "0.00"
        assert response.json()["currencies"][0]["categories"] == []

        response = user_client.get(reverse("api:dashboard"), {"month": "2026-11"})
        summary = response.json()["currencies"][0]
        assert (summary["income"], summary["expenses"]) == ("100.00", "0.00")
        assert [(item["name"], item["balance"]) for item in response.json()["wallets"]] == [
            ("Bank", "50.00"),
            ("Cash", "50.00"),
        ]
