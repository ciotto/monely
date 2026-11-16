import datetime
import io
import zipfile
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from openpyxl import Workbook

from core.models import BankMovement, ImportFormat, Transaction, Wallet
from core.reconciliation import match

# A statement as exported by many Italian banks: some text before the header, a total after the movements
STATEMENT = (
    "Estratto conto;;\r\n"
    "Data contabile;Descrizione;Importo\r\n"
    "02/11/2026;Supermercato   Coop;-45,30\r\n"
    "03/11/2026 10:22;Stipendio;1.500,00\r\n"
    ";;\r\n"
    "Saldo finale;;1.454,70\r\n"
)


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def wallet():
    wallet = Wallet.objects.create(name="Bank")
    ImportFormat.objects.create(
        wallet=wallet, date_column="Data contabile", amount_column="Importo", description_column="Descrizione"
    )
    return wallet


def csv_file(text, encoding="utf-8"):
    return SimpleUploadedFile("statement.csv", text.encode(encoding), content_type="text/csv")


def xlsx_file(rows):
    workbook = Workbook()
    for row in rows:
        workbook.active.append(row)
    content = io.BytesIO()
    workbook.save(content)
    return SimpleUploadedFile("statement.xlsx", content.getvalue())


def movements(wallet):
    return [(item.date.isoformat(), str(item.amount), item.description) for item in wallet.bank_movements.all()]


def create_transaction(wallet, day, amount):
    return Transaction.objects.create(
        wallet=wallet, date=datetime.date(2026, 11, day), amount=Decimal(amount), description="Manual"
    )


def create_movement(wallet, day, amount, **fields):
    return BankMovement.objects.create(
        wallet=wallet, date=datetime.date(2026, 11, day), amount=Decimal(amount), **fields
    )


@pytest.mark.django_db
class TestStatementImportView:
    @staticmethod
    def url(wallet):
        return reverse("api:wallet-import", args=[wallet.pk])

    def test_import_csv(self, user_client, wallet):
        response = user_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        assert response.status_code == 201
        assert response.json() == {"imported": 2, "duplicates": 0}
        assert movements(wallet) == [
            ("2026-11-03", "1500.00", "Stipendio"),
            ("2026-11-02", "-45.30", "Supermercato Coop"),
        ]
        # The movements are reconciled, not created as transactions
        assert not Transaction.objects.exists()

    def test_import_csv_windows_encoding(self, user_client, wallet):
        text = "Data contabile;Descrizione;Importo\r\n02/11/2026;Caffè;-1,20 €\r\n"

        response = user_client.post(self.url(wallet), {"file": csv_file(text, "cp1252")})

        assert response.status_code == 201
        assert movements(wallet) == [("2026-11-02", "-1.20", "Caffè")]

    def test_import_csv_with_byte_order_mark(self, user_client, wallet):
        text = "﻿Data contabile;Importo;Descrizione\r\n02/11/2026;-1,20\r\n"

        response = user_client.post(self.url(wallet), {"file": csv_file(text)})

        assert response.status_code == 201
        assert movements(wallet) == [("2026-11-02", "-1.20", "")]

    def test_import_csv_with_other_format(self, user_client, wallet):
        ImportFormat.objects.filter(wallet=wallet).update(
            date_column="date",
            amount_column="amount",
            description_column="",
            date_format="%Y-%m-%d",
            decimal_separator=".",
            delimiter=",",
        )
        text = 'date,amount\r\n2026-11-02,"-1,234.50"\r\n2026-11-03,12.30-\r\n'

        response = user_client.post(self.url(wallet), {"file": csv_file(text)})

        assert response.status_code == 201
        # Some banks write the sign after the number
        assert movements(wallet) == [("2026-11-03", "-12.30", ""), ("2026-11-02", "-1234.50", "")]

    def test_import_income_and_expense_columns(self, user_client, wallet):
        ImportFormat.objects.filter(wallet=wallet).update(
            amount_column="", income_column="Entrate", expense_column="Uscite"
        )
        text = (
            "Data contabile;Entrate;Uscite;Descrizione\r\n"
            "02/11/2026;;45,30;Coop\r\n"
            "03/11/2026;1.500,00;;Stipendio\r\n"
            "04/11/2026;;-9,99;Streaming\r\n"
            # Still to be booked
            "05/11/2026;;;Pending\r\n"
        )

        response = user_client.post(self.url(wallet), {"file": csv_file(text)})

        assert response.status_code == 201
        assert movements(wallet) == [
            ("2026-11-04", "-9.99", "Streaming"),
            ("2026-11-03", "1500.00", "Stipendio"),
            ("2026-11-02", "-45.30", "Coop"),
        ]

    def test_import_negated_amounts(self, user_client, wallet):
        # e.g. a credit card that lists the expenses as positive amounts
        ImportFormat.objects.filter(wallet=wallet).update(negate_amounts=True)
        text = "Data contabile;Importo;Descrizione\r\n02/11/2026;45,30\r\n03/11/2026;-10,00\r\n"

        response = user_client.post(self.url(wallet), {"file": csv_file(text)})

        assert response.status_code == 201
        assert movements(wallet) == [("2026-11-03", "10.00", ""), ("2026-11-02", "-45.30", "")]

    def test_import_xlsx(self, user_client, wallet):
        rows = [
            ("Movimenti",),
            (" data contabile ", "IMPORTO", "Descrizione"),
            (datetime.datetime(2026, 11, 2, 0, 0), -45.3, "Coop"),
            (datetime.date(2026, 11, 3), 1500, "Stipendio\nNovembre"),
            ("04/11/2026", "-9,99", None),
            # A short row, and a total
            (datetime.datetime(2026, 11, 5),),
            ("Totale", 1444.71),
        ]

        response = user_client.post(self.url(wallet), {"file": xlsx_file(rows)})

        assert response.status_code == 201
        assert response.json() == {"imported": 3, "duplicates": 0}
        assert movements(wallet) == [
            ("2026-11-04", "-9.99", ""),
            ("2026-11-03", "1500.00", "Stipendio Novembre"),
            ("2026-11-02", "-45.30", "Coop"),
        ]

    def test_import_zero_amount(self, user_client, wallet):
        text = "Data contabile;Importo;Descrizione\r\n02/11/2026;0,00\r\n03/11/2026;-1,00\r\n"

        response = user_client.post(self.url(wallet), {"file": csv_file(text)})

        assert response.json() == {"imported": 1, "duplicates": 0}

    def test_skip_duplicates(self, user_client, wallet):
        # The bank changed the description since the previous import: only date and amount count
        create_movement(wallet, 2, "-45.30", description="POS Coop")

        response = user_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        assert response.status_code == 201
        assert response.json() == {"imported": 1, "duplicates": 1}
        assert movements(wallet) == [("2026-11-03", "1500.00", "Stipendio"), ("2026-11-02", "-45.30", "POS Coop")]

    def test_import_twice(self, user_client, wallet):
        user_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        response = user_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        assert response.json() == {"imported": 0, "duplicates": 2}
        assert wallet.bank_movements.count() == 2

    def test_import_identical_movements(self, user_client, wallet):
        # Two coffees on the same day were already imported, a later statement lists a third one
        create_movement(wallet, 2, "-1.20")
        create_movement(wallet, 2, "-1.20")
        text = "Data contabile;Importo;Descrizione\r\n" + "02/11/2026;-1,20\r\n" * 3

        response = user_client.post(self.url(wallet), {"file": csv_file(text)})

        assert response.json() == {"imported": 1, "duplicates": 2}
        assert wallet.bank_movements.count() == 3

    def test_duplicates_of_other_wallets(self, user_client, wallet):
        create_movement(Wallet.objects.create(name="Card"), 2, "-45.30")

        response = user_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        assert response.json() == {"imported": 2, "duplicates": 0}

    def test_invalid_amounts(self, user_client, wallet):
        text = (
            "Data contabile;Importo;Descrizione\r\n"
            "02/11/2026;abc\r\n"
            "03/11/2026;-1,00\r\n"
            # Beyond the digits of the amounts
            "04/11/2026;99.999.999.999,00\r\n"
        )

        response = user_client.post(self.url(wallet), {"file": csv_file(text)})

        assert response.status_code == 400
        assert response.json() == {"file": ["Row 2: the amount is not valid.", "Row 4: the amount is not valid."]}
        assert not BankMovement.objects.exists()

    def test_missing_columns(self, user_client, wallet):
        response = user_client.post(self.url(wallet), {"file": csv_file("Data;Importo\r\n02/11/2026;-1,00\r\n")})

        assert response.status_code == 400
        assert response.json() == {
            "file": ["No row of the file has the columns: Data contabile, Importo, Descrizione."]
        }

    def test_no_movements(self, user_client, wallet):
        # e.g. a wrong date format
        response = user_client.post(
            self.url(wallet), {"file": csv_file("Data contabile;Importo;Descrizione\r\n2026-11-02;-1\r\n")}
        )

        assert response.status_code == 400
        assert response.json() == {"file": ["The file contains no movements: check the import format of the wallet."]}

    def test_invalid_encoding(self, user_client, wallet):
        response = user_client.post(self.url(wallet), {"file": SimpleUploadedFile("statement.csv", b"\x81\x8d")})

        assert response.status_code == 400
        assert response.json() == {"file": ["The file must be a CSV or an xlsx file."]}

    def test_archive_that_is_not_a_workbook(self, user_client, wallet):
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as archive:
            archive.writestr("statement.csv", STATEMENT)

        response = user_client.post(self.url(wallet), {"file": SimpleUploadedFile("statement.zip", content.getvalue())})

        assert response.status_code == 400
        assert response.json() == {"file": ["The file must be a CSV or an xlsx file."]}

    def test_missing_file(self, user_client, wallet):
        response = user_client.post(self.url(wallet), {})

        assert response.status_code == 400
        assert set(response.json()) == {"file"}

    def test_without_import_format(self, user_client):
        wallet = Wallet.objects.create(name="Cash")

        response = user_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        assert response.status_code == 400
        assert response.json() == {"wallet": ["This wallet has no import format: set it up first."]}

    def test_archived_wallet(self, user_client, wallet):
        Wallet.objects.filter(pk=wallet.pk).update(is_archived=True)

        response = user_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        assert response.status_code == 400
        assert response.json() == {"wallet": ["This wallet is archived."]}

    def test_unknown_wallet(self, user_client):
        response = user_client.post(reverse("api:wallet-import", args=[999]), {"file": csv_file(STATEMENT)})

        assert response.status_code == 404

    def test_anonymous(self, api_client, wallet):
        response = api_client.post(self.url(wallet), {"file": csv_file(STATEMENT)})

        assert response.status_code == 403


class TestMatch:
    def test_closest_date(self):
        day = datetime.date(2026, 11, 10)
        amount = Decimal("-10.00")
        movements = [(1, 1, day, amount), (2, 1, day + datetime.timedelta(days=3), amount)]
        transactions = [
            (10, 1, day + datetime.timedelta(days=2), amount),
            (11, 1, day + datetime.timedelta(days=4), amount),
            (12, 1, day - datetime.timedelta(days=6), amount),
        ]

        # The second movement is closer to the first transaction, the first one falls back on the last one in range
        assert match(movements, transactions) == {2: 10, 1: 11}

    def test_same_distance(self):
        day = datetime.date(2026, 11, 10)
        amount = Decimal("-10.00")
        movements = [(2, 1, day, amount), (1, 1, day, amount)]
        transactions = [(11, 1, day, amount), (10, 1, day, amount)]

        assert match(movements, transactions) == {1: 10, 2: 11}

    def test_different_wallet_or_amount(self):
        day = datetime.date(2026, 11, 10)
        movements = [(1, 1, day, Decimal("-10.00"))]
        transactions = [(10, 2, day, Decimal("-10.00")), (11, 1, day, Decimal("10.00"))]

        assert match(movements, transactions) == {}


@pytest.mark.django_db
class TestBankMovementListView:
    url = reverse("api:bank-movements")

    def test_list(self, user_client, wallet):
        reconciled = create_movement(wallet, 2, "-45.30", description="Coop")
        missing = create_movement(wallet, 3, "-9.99")
        # Entered with the date of the purchase, a few days before the bank booked it
        transaction = create_transaction(wallet, 1, "-45.30")
        # Not in the bank statements
        create_transaction(wallet, 3, "-5.00")

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert response.json() == [
            {
                "id": missing.pk,
                "wallet": wallet.pk,
                "date": "2026-11-03",
                "amount": "-9.99",
                "description": "",
                "is_ignored": False,
                "transaction": None,
                "created_at": missing.created_at.isoformat().replace("+00:00", "Z"),
            },
            {
                "id": reconciled.pk,
                "wallet": wallet.pk,
                "date": "2026-11-02",
                "amount": "-45.30",
                "description": "Coop",
                "is_ignored": False,
                "transaction": transaction.pk,
                "created_at": reconciled.created_at.isoformat().replace("+00:00", "Z"),
            },
        ]

    def test_status(self, user_client, wallet):
        reconciled = create_movement(wallet, 2, "-45.30")
        create_transaction(wallet, 7, "-45.30")
        missing = create_movement(wallet, 3, "-9.99")
        # Beyond the tolerance
        create_transaction(wallet, 9, "-9.99")
        ignored = create_movement(wallet, 4, "-1.00", is_ignored=True)
        # Ignored movements do not take the transactions of the others
        create_transaction(wallet, 4, "-1.00")
        # Archived wallets do not receive new transactions
        archived = Wallet.objects.create(name="Old", is_archived=True)
        create_movement(archived, 2, "-3.00")

        def ids(status):
            return [item["id"] for item in user_client.get(self.url, {"status": status}).json()]

        assert ids("missing") == [missing.pk]
        assert ids("reconciled") == [reconciled.pk]
        assert ids("ignored") == [ignored.pk]

    def test_wallet(self, user_client, wallet):
        other = Wallet.objects.create(name="Card")
        create_movement(other, 2, "-45.30")
        # A transaction of another wallet does not reconcile the movement
        create_transaction(other, 2, "-9.99")
        movement = create_movement(wallet, 2, "-9.99")

        response = user_client.get(self.url, {"wallet": wallet.pk})

        assert [(item["id"], item["transaction"]) for item in response.json()] == [(movement.pk, None)]

    def test_empty(self, user_client):
        response = user_client.get(self.url, {"status": "missing"})

        assert response.json() == []

    def test_invalid_filters(self, user_client):
        response = user_client.get(self.url, {"wallet": 999, "status": "lost"})

        assert response.status_code == 400
        assert set(response.json()) == {"wallet", "status"}

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403


@pytest.mark.django_db
class TestBankMovementDetailView:
    @staticmethod
    def url(movement):
        return reverse("api:bank-movement", args=[movement.pk])

    def test_retrieve(self, user_client, wallet):
        movement = create_movement(wallet, 2, "-45.30")
        transaction = create_transaction(wallet, 2, "-45.30")

        response = user_client.get(self.url(movement))

        assert response.status_code == 200
        assert response.json()["transaction"] == transaction.pk

    def test_ignore(self, user_client, wallet):
        movement = create_movement(wallet, 2, "-45.30")

        response = user_client.patch(
            self.url(movement), {"is_ignored": True, "amount": "1.00", "date": "2026-01-01"}, format="json"
        )

        assert response.status_code == 200
        assert response.json()["is_ignored"]
        movement.refresh_from_db()
        assert movement.is_ignored
        # The other fields come from the bank
        assert movement.amount == Decimal("-45.30")
        assert movement.date == datetime.date(2026, 11, 2)

    def test_delete_not_allowed(self, user_client, wallet):
        movement = create_movement(wallet, 2, "-45.30")

        response = user_client.delete(self.url(movement))

        assert response.status_code == 405
        assert BankMovement.objects.exists()

    def test_anonymous(self, api_client, wallet):
        response = api_client.get(self.url(create_movement(wallet, 2, "-45.30")))

        assert response.status_code == 403
