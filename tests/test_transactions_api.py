import datetime
from decimal import Decimal

import pytest
from django.urls import reverse

from core.models import Category, Tag, Transaction, Transfer, Wallet


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def wallet():
    return Wallet.objects.create(name="Bank")


@pytest.fixture
def category():
    return Category.objects.create(name="Groceries")


@pytest.fixture
def tags():
    return [Tag.objects.create(name="holiday-2026"), Tag.objects.create(name="car")]


def create_transaction(wallet, day=1, amount="-10.00", **fields):
    tags = fields.pop("tags", [])
    transaction = Transaction.objects.create(
        wallet=wallet, date=datetime.date(2026, 11, day), amount=Decimal(amount), description="Shopping", **fields
    )
    transaction.tags.set(tags)
    return transaction


@pytest.mark.django_db
class TestTransactionListView:
    url = reverse("api:transactions")

    def test_list(self, user_client, wallet, category, tags):
        older = create_transaction(wallet, day=1)
        transaction = create_transaction(
            wallet, day=5, amount="1500.50", category=category, tags=tags, notes="November salary"
        )

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["results"]] == [transaction.pk, older.pk]
        assert response.json()["results"][0] == {
            "id": transaction.pk,
            "wallet": wallet.pk,
            "date": "2026-11-05",
            "amount": "1500.50",
            "description": "Shopping",
            "category": category.pk,
            # Ordered by name, like the tags themselves
            "tags": [tags[1].pk, tags[0].pk],
            "notes": "November salary",
            "transfer": None,
            "created_at": transaction.created_at.isoformat().replace("+00:00", "Z"),
        }

    def test_list_same_date_newest_first(self, user_client, wallet):
        first = create_transaction(wallet)
        second = create_transaction(wallet)

        response = user_client.get(self.url)

        assert [item["id"] for item in response.json()["results"]] == [second.pk, first.pk]

    def test_list_paginated(self, user_client, wallet):
        Transaction.objects.bulk_create(
            Transaction(wallet=wallet, date=datetime.date(2026, 11, 1), amount=Decimal("-1.00"), description="Coffee")
            for _ in range(502)
        )
        ids = list(Transaction.objects.values_list("pk", flat=True))

        response = user_client.get(self.url)

        assert response.json()["count"] == 502
        assert [item["id"] for item in response.json()["results"]] == ids[:500]
        assert response.json()["next"] is not None

        # The next page starts after the rows already loaded, and a page never exceeds 500 rows
        response = user_client.get(self.url, {"offset": 500, "limit": 1000})

        assert [item["id"] for item in response.json()["results"]] == ids[500:]
        assert response.json()["next"] is None

    def test_list_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403

    @pytest.mark.parametrize(
        "kind,expected", [("income", ["salary"]), ("expense", ["shopping"]), ("transfer", ["out", "in"])]
    )
    def test_filter_by_kind(self, user_client, wallet, kind, expected):
        # The transactions of a transfer are neither income nor expenses
        transfer = Transfer.objects.create()
        transactions = {
            "salary": create_transaction(wallet, day=4, amount="1500.00"),
            "shopping": create_transaction(wallet, day=3),
            "out": create_transaction(wallet, day=2, amount="-50.00", transfer=transfer),
            "in": create_transaction(Wallet.objects.create(name="Cash"), day=1, amount="50.00", transfer=transfer),
        }

        response = user_client.get(self.url, {"kind": kind})

        assert [item["id"] for item in response.json()["results"]] == [transactions[name].pk for name in expected]

    def test_filter_by_wallet(self, user_client, wallet):
        transaction = create_transaction(wallet)
        create_transaction(Wallet.objects.create(name="Cash"))

        response = user_client.get(self.url, {"wallet": wallet.pk})

        assert [item["id"] for item in response.json()["results"]] == [transaction.pk]

    def test_filter_by_category(self, user_client, wallet, category):
        transaction = create_transaction(wallet, category=category)
        create_transaction(wallet)

        response = user_client.get(self.url, {"category": category.pk})

        assert [item["id"] for item in response.json()["results"]] == [transaction.pk]

    def test_filter_without_category(self, user_client, wallet, category):
        transaction = create_transaction(wallet)
        create_transaction(wallet, category=category)
        # The transactions of a transfer are not listed as uncategorized
        create_transaction(wallet, transfer=Transfer.objects.create())

        response = user_client.get(self.url, {"category": "none"})

        assert [item["id"] for item in response.json()["results"]] == [transaction.pk]

    def test_filter_by_tags(self, user_client, wallet, tags):
        # A transaction matches when it has any of the tags, and it is listed once
        both = create_transaction(wallet, day=3, tags=tags)
        one = create_transaction(wallet, day=2, tags=tags[1:])
        create_transaction(wallet, day=1, tags=[Tag.objects.create(name="gift")])
        create_transaction(wallet, day=1)

        response = user_client.get(self.url, {"tag": [tag.pk for tag in tags]})

        assert [item["id"] for item in response.json()["results"]] == [both.pk, one.pk]

    def test_filter_by_date_range(self, user_client, wallet):
        create_transaction(wallet, day=1)
        inside = [create_transaction(wallet, day=day) for day in (10, 2)]
        create_transaction(wallet, day=11)

        response = user_client.get(self.url, {"date_from": "2026-11-02", "date_to": "2026-11-10"})

        assert [item["id"] for item in response.json()["results"]] == [transaction.pk for transaction in inside]

    def test_filter_combined(self, user_client, wallet, category):
        transaction = create_transaction(wallet, day=5, category=category)
        create_transaction(wallet, day=1, category=category)
        create_transaction(wallet, day=5)

        response = user_client.get(self.url, {"category": category.pk, "date_from": "2026-11-05"})

        assert [item["id"] for item in response.json()["results"]] == [transaction.pk]

    @pytest.mark.parametrize(
        "params,field",
        [
            ({"wallet": 999}, "wallet"),
            ({"kind": "refund"}, "kind"),
            ({"category": "groceries"}, "category"),
            ({"tag": 999}, "tag"),
            ({"date_from": "11/02/2026"}, "date_from"),
            ({"date_from": "2026-11-10", "date_to": "2026-11-02"}, "date_to"),
        ],
    )
    def test_invalid_filter(self, user_client, params, field):
        response = user_client.get(self.url, params)

        assert response.status_code == 400
        assert set(response.json()) == {field}


@pytest.mark.django_db
class TestTransactionCreate:
    url = reverse("api:transactions")

    def test_create(self, user_client, wallet, category, tags):
        response = user_client.post(
            self.url,
            {
                "wallet": wallet.pk,
                "date": "2026-11-12",
                "amount": "-42.30",
                "description": "Supermarket",
                "category": category.pk,
                "tags": [tag.pk for tag in tags],
                "notes": "Weekly shopping",
            },
            format="json",
        )

        assert response.status_code == 201
        transaction = Transaction.objects.get()
        assert response.json()["id"] == transaction.pk
        assert transaction.wallet == wallet
        assert transaction.date == datetime.date(2026, 11, 12)
        assert transaction.amount == Decimal("-42.30")
        assert transaction.description == "Supermarket"
        assert transaction.category == category
        assert set(transaction.tags.all()) == set(tags)
        assert transaction.notes == "Weekly shopping"

    def test_create_minimal(self, user_client, wallet):
        response = user_client.post(
            self.url,
            {"wallet": wallet.pk, "date": "2026-11-12", "amount": "100", "description": "Gift"},
            format="json",
        )

        assert response.status_code == 201
        transaction = Transaction.objects.get()
        assert transaction.category is None
        assert not transaction.tags.exists()
        assert transaction.notes == ""

    def test_create_missing_fields(self, user_client):
        response = user_client.post(self.url, {}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"wallet", "date", "amount", "description"}

    @pytest.mark.parametrize("amount", ["0", "0.00", "-0", "abc", "1.234", "12345678901.00"])
    def test_create_invalid_amount(self, user_client, wallet, amount):
        response = user_client.post(
            self.url,
            {"wallet": wallet.pk, "date": "2026-11-12", "amount": amount, "description": "Gift"},
            format="json",
        )

        assert response.status_code == 400
        assert set(response.json()) == {"amount"}

    def test_create_zero_amount_message(self, user_client, wallet):
        response = user_client.post(
            self.url,
            {"wallet": wallet.pk, "date": "2026-11-12", "amount": "0", "description": "Gift"},
            format="json",
        )

        assert response.json() == {"amount": ["The amount cannot be zero."]}

    def test_create_on_archived_wallet(self, user_client):
        wallet = Wallet.objects.create(name="Old account", is_archived=True)

        response = user_client.post(
            self.url,
            {"wallet": wallet.pk, "date": "2026-11-12", "amount": "-5", "description": "Coffee"},
            format="json",
        )

        assert response.status_code == 400
        assert response.json() == {"wallet": ["This wallet is archived."]}
        assert not Transaction.objects.exists()

    def test_create_unknown_relations(self, user_client, wallet):
        response = user_client.post(
            self.url,
            {
                "wallet": wallet.pk,
                "date": "2026-11-12",
                "amount": "-5",
                "description": "Coffee",
                "category": 999,
                "tags": [999],
            },
            format="json",
        )

        assert response.status_code == 400
        assert set(response.json()) == {"category", "tags"}

    def test_create_without_csrf_token(self, api_client, user, wallet):
        api_client.force_login(user)

        response = api_client.post(
            self.url,
            {"wallet": wallet.pk, "date": "2026-11-12", "amount": "-5", "description": "Coffee"},
            format="json",
        )

        assert response.status_code == 403


@pytest.mark.django_db
class TestTransactionDetail:
    @staticmethod
    def url(transaction):
        return reverse("api:transaction", args=[transaction.pk])

    def test_retrieve(self, user_client, wallet):
        transaction = create_transaction(wallet)

        response = user_client.get(self.url(transaction))

        assert response.status_code == 200
        assert response.json()["description"] == "Shopping"

    def test_update(self, user_client, wallet, category, tags):
        transaction = create_transaction(wallet, category=category, tags=tags)

        response = user_client.patch(
            self.url(transaction),
            {"amount": "-12.00", "category": None, "tags": [tags[0].pk], "notes": "Split with Luca"},
            format="json",
        )

        assert response.status_code == 200
        transaction.refresh_from_db()
        assert transaction.amount == Decimal("-12.00")
        assert transaction.category is None
        assert list(transaction.tags.all()) == [tags[0]]
        assert transaction.notes == "Split with Luca"

    def test_update_on_archived_wallet(self, user_client, wallet):
        # Transactions of an archived wallet can still be fixed
        transaction = create_transaction(wallet)
        wallet.is_archived = True
        wallet.save()

        response = user_client.patch(self.url(transaction), {"wallet": wallet.pk, "amount": "-11"}, format="json")

        assert response.status_code == 200
        transaction.refresh_from_db()
        assert transaction.amount == Decimal("-11")

    def test_move_to_archived_wallet(self, user_client, wallet):
        transaction = create_transaction(wallet)
        archived = Wallet.objects.create(name="Old account", is_archived=True)

        response = user_client.patch(self.url(transaction), {"wallet": archived.pk}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"wallet"}

    def test_delete(self, user_client, wallet):
        transaction = create_transaction(wallet)

        response = user_client.delete(self.url(transaction))

        assert response.status_code == 204
        assert not Transaction.objects.exists()

    def test_anonymous(self, api_client, wallet):
        transaction = create_transaction(wallet)

        response = api_client.get(self.url(transaction))

        assert response.status_code == 403
