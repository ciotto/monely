import datetime
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from core.models import Category, Tag, Transaction, Transfer, Wallet

HEADER = "date,wallet,currency,amount,description,category,tags,notes,transfer\r\n"


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def wallet():
    return Wallet.objects.create(name="Bank")


def create_transaction(wallet, day=1, amount="-10.00", **fields):
    tags = fields.pop("tags", [])
    transaction = Transaction.objects.create(
        wallet=wallet, date=datetime.date(2026, 11, day), amount=Decimal(amount), description="Shopping", **fields
    )
    transaction.tags.set(tags)
    return transaction


@pytest.mark.django_db
class TestTransactionExportView:
    url = reverse("api:transactions-export")

    def test_export(self, user_client, wallet):
        category = Category.objects.create(name="Groceries")
        tags = [Tag.objects.create(name="holiday-2026"), Tag.objects.create(name="car")]
        create_transaction(wallet, day=5, amount="1500.50", category=category, tags=tags, notes='Line 1\n"Line 2"')
        create_transaction(Wallet.objects.create(name="Card", currency="USD"), day=1)

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert response["Content-Type"] == "text/csv; charset=utf-8"
        assert response["Content-Disposition"].startswith('attachment; filename="monely-transactions-')
        # Oldest first, with the byte order mark for the spreadsheets
        assert response.content.decode() == (
            "﻿"
            + HEADER
            + "2026-11-01,Card,USD,-10.00,Shopping,,,,\r\n"
            + '2026-11-05,Bank,EUR,1500.50,Shopping,Groceries,car|holiday-2026,"Line 1\n""Line 2""",\r\n'
        )

    def test_export_transfer(self, user_client, wallet):
        transfer = Transfer.objects.create()
        create_transaction(wallet, day=3, amount="-50.00", transfer=transfer)
        create_transaction(Wallet.objects.create(name="Cash"), day=3, amount="50.00", transfer=transfer)

        response = user_client.get(self.url)

        assert response.content.decode().splitlines()[1:] == [
            f"2026-11-03,Bank,EUR,-50.00,Shopping,,,,{transfer.pk}",
            f"2026-11-03,Cash,EUR,50.00,Shopping,,,,{transfer.pk}",
        ]

    def test_export_filtered(self, user_client, wallet):
        tag = Tag.objects.create(name="car")
        create_transaction(wallet, day=1, tags=[tag])
        create_transaction(wallet, day=2)

        response = user_client.get(self.url, {"tag": tag.pk, "date_from": "2026-11-01"})

        assert response.content.decode().splitlines()[1:] == ["2026-11-01,Bank,EUR,-10.00,Shopping,,car,,"]

    def test_export_invalid_filters(self, user_client):
        response = user_client.get(self.url, {"date_from": "2026-11-02", "date_to": "2026-11-01"})

        assert response.status_code == 400
        assert response.json() == {"date_to": ["The end date cannot precede the start date."]}

    def test_export_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403


@pytest.mark.django_db
class TestTransactionImportView:
    url = reverse("api:transactions-import")

    def post(self, client, content):
        if isinstance(content, str):
            content = content.encode()
        return client.post(
            self.url, {"file": SimpleUploadedFile("transactions.csv", content, "text/csv")}, format="multipart"
        )

    def test_import(self, user_client, user, wallet):
        category = Category.objects.create(name="Groceries")
        tag = Tag.objects.create(name="car")

        response = self.post(
            user_client,
            "﻿"
            + HEADER
            + "2026-11-01,bank,EUR,-10.50,Supermarket,groceries,CAR | holiday-2026,\r\n"
            + '2026-11-02,Card,USD,1500,Pay,Salary,holiday-2026|,"Line 1\n""Line 2"""\r\n'
            + "2026-11-03,Card,,-1.00,Coffee,,,\r\n",
        )

        assert response.status_code == 201
        assert response.json() == {"transactions": 3, "wallets": 1, "categories": 1, "tags": 1}
        card = Wallet.objects.get(name="Card")
        assert card.currency == "USD"
        assert list(card.owners.all()) == [user]
        holiday = Tag.objects.get(name="holiday-2026")
        salary = Category.objects.get(name="Salary")
        assert salary.color == "#64748b"
        transactions = Transaction.objects.order_by("id")
        assert [
            (t.wallet, t.date, t.amount, t.description, t.category, list(t.tags.all()), t.notes) for t in transactions
        ] == [
            (wallet, datetime.date(2026, 11, 1), Decimal("-10.50"), "Supermarket", category, [tag, holiday], ""),
            (card, datetime.date(2026, 11, 2), Decimal("1500.00"), "Pay", salary, [holiday], 'Line 1\n"Line 2"'),
            (card, datetime.date(2026, 11, 3), Decimal("-1.00"), "Coffee", None, [], ""),
        ]

    def test_import_new_wallet_default_currency(self, user_client):
        response = self.post(user_client, "date,wallet,amount,description\n2026-11-01,Cash,-5,Bread\n")

        assert response.status_code == 201
        assert response.json() == {"transactions": 1, "wallets": 1, "categories": 0, "tags": 0}
        assert Wallet.objects.get().currency == "EUR"

    def test_import_round_trip(self, user_client, wallet):
        tags = [Tag.objects.create(name="car")]
        create_transaction(wallet, day=1, category=Category.objects.create(name="Fuel"), tags=tags, notes="Full")
        create_transaction(wallet, day=2, amount="100.00")
        exported = user_client.get(reverse("api:transactions-export")).content
        Transaction.objects.all().delete()

        response = self.post(user_client, exported)

        assert response.status_code == 201
        assert user_client.get(reverse("api:transactions-export")).content == exported

    def test_import_transfers(self, user_client, wallet):
        response = self.post(
            user_client,
            HEADER
            + "2026-11-01,Bank,EUR,-50,ATM,,,,a\r\n"
            + "2026-11-01,Bank,EUR,-10,Coffee,,,,\r\n"
            + "2026-11-01,Cash,EUR,50,ATM,,,,a\r\n"
            + "2026-11-02,Bank,EUR,-20,ATM,,,,b\r\n"
            + "2026-11-02,Cash,EUR,20,ATM,,,,b\r\n",
        )

        assert response.status_code == 201
        assert response.json() == {"transactions": 5, "wallets": 1, "categories": 0, "tags": 0}
        transfers = list(Transfer.objects.order_by("id"))
        assert len(transfers) == 2
        assert [sorted((t.wallet.name, t.amount) for t in transfer.transactions.all()) for transfer in transfers] == [
            [("Bank", Decimal("-50.00")), ("Cash", Decimal("50.00"))],
            [("Bank", Decimal("-20.00")), ("Cash", Decimal("20.00"))],
        ]
        assert Transaction.objects.get(description="Coffee").transfer is None

    def test_import_transfer_round_trip(self, user_client, wallet):
        transfer = Transfer.objects.create()
        create_transaction(wallet, day=3, amount="-50.00", transfer=transfer)
        create_transaction(Wallet.objects.create(name="Cash"), day=3, amount="50.00", transfer=transfer)
        exported = user_client.get(reverse("api:transactions-export")).content
        Transfer.objects.all().delete()

        response = self.post(user_client, exported)

        assert response.status_code == 201
        new = Transfer.objects.get()
        assert user_client.get(reverse("api:transactions-export")).content == exported.replace(
            f",{transfer.pk}\r\n".encode(), f",{new.pk}\r\n".encode()
        )

    @pytest.mark.parametrize(
        "rows, error",
        [
            (["2026-11-01,Bank,EUR,-50,ATM,,,,a"], "Row 2, transfer: A transfer needs exactly two rows."),
            (
                ["2026-11-01,Bank,EUR,-50,ATM,,,,a", "2026-11-01,Cash,EUR,50,ATM,,,,a", "2026-11-01,Cash,EUR,1,x,,,,a"],
                "Row 2, transfer: A transfer needs exactly two rows.",
            ),
            (["2026-11-01,Bank,EUR,-50,ATM,,,,a", "2026-11-01,Cash,EUR,40,ATM,,,,a"], "MISMATCH"),
            (["2026-11-01,Bank,EUR,-50,ATM,,,,a", "2026-11-02,Cash,EUR,50,ATM,,,,a"], "MISMATCH"),
            (["2026-11-01,Bank,EUR,-50,ATM,,,,a", "2026-11-01,Bank,EUR,50,ATM,,,,a"], "MISMATCH"),
            (["2026-11-01,Bank,EUR,-50,ATM,,,,a", "2026-11-01,Card,USD,50,ATM,,,,a"], "MISMATCH"),
            (["2026-11-01,Bank,EUR,-50,ATM,Fees,,,a"], "Row 2, transfer: A transfer has no category and no tags."),
            (["2026-11-01,Bank,EUR,-50,ATM,,car,,a"], "Row 2, transfer: A transfer has no category and no tags."),
        ],
    )
    def test_import_invalid_transfer(self, user_client, wallet, rows, error):
        if error == "MISMATCH":
            error = (
                "Row 2, transfer: The rows of a transfer need opposite amounts, the same date and different wallets "
                "with the same currency."
            )

        response = self.post(user_client, HEADER + "".join(f"{row}\r\n" for row in rows))

        assert response.status_code == 400
        assert response.json() == {"file": [error]}
        assert not Transaction.objects.exists()
        assert not Transfer.objects.exists()

    def test_import_errors_roll_back(self, user_client, wallet):
        Wallet.objects.create(name="Twin")
        Wallet.objects.create(name="twin")
        Wallet.objects.create(name="Old", is_archived=True)

        response = self.post(
            user_client,
            HEADER
            + "2026-11-01,New,EUR,-1,Valid,New category,new-tag,\r\n"
            + "not-a-date,Bank,EUR,0,,,,\r\n"
            + "2026-11-02,Bank,USD,-1,Wrong currency,,,\r\n"
            + "2026-11-03,Twin,,-1,Ambiguous,,,\r\n"
            + "2026-11-04,Old,,-1,Archived,,,\r\n"
            + f"2026-11-05,Bank,eur,-1,Long tag,,{'x' * 51},\r\n",
        )

        assert response.status_code == 400
        assert response.json() == {
            "file": [
                "Row 3, date: Date has wrong format. Use one of these formats instead: YYYY-MM-DD.",
                "Row 3, amount: The amount cannot be zero.",
                "Row 3, description: This field is required.",
                "Row 4, currency: The wallet uses EUR.",
                "Row 5, wallet: More than one wallet has this name.",
                "Row 6, wallet: This wallet is archived.",
                "Row 7, currency: This value does not match the required pattern.",
                "Row 7, tags: Ensure every tag has no more than 50 characters.",
            ]
        }
        # Nothing from the valid rows is kept
        assert not Transaction.objects.exists()
        assert list(Wallet.objects.values_list("name", flat=True)) == ["Bank", "Twin", "twin", "Old"]
        assert not Category.objects.exists()
        assert not Tag.objects.exists()

    @pytest.mark.parametrize(
        "content, error",
        [
            ("date,amount\n2026-11-01,-1\n", "Missing columns: wallet, description."),
            (HEADER, "The file contains no transactions."),
            ("\n", "Missing columns: date, wallet, amount, description."),
            ("caf\xe9".encode("latin-1"), "The file must be a CSV encoded in UTF-8."),
        ],
    )
    def test_import_invalid_file(self, user_client, content, error):
        response = self.post(user_client, content)

        assert response.status_code == 400
        assert response.json() == {"file": [error]}

    def test_import_without_file(self, user_client):
        response = user_client.post(self.url, {}, format="multipart")

        assert response.status_code == 400
        assert response.json() == {"file": ["No file was submitted."]}

    def test_import_anonymous(self, api_client):
        response = self.post(api_client, HEADER)

        assert response.status_code == 403
