import datetime
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from core.models import Contribution, Transaction, Transfer, User, Wallet


@pytest.fixture
def anna():
    return User.objects.create_user("anna@example.com", first_name="Anna", last_name="Bianchi")


@pytest.fixture
def bruno():
    return User.objects.create_user("bruno@example.com", first_name="Bruno", last_name="Verdi")


@pytest.fixture
def anna_client(api_client, anna):
    api_client.force_login(anna)
    return api_client


def create_wallet(name, owners, currency="EUR", **fields):
    wallet = Wallet.objects.create(name=name, currency=currency, **fields)
    wallet.owners.set(owners)
    return wallet


def create_contribution(amount="0", start_month=datetime.date(2026, 10, 1), currency="EUR"):
    return Contribution.objects.create(currency=currency, amount=Decimal(amount), start_month=start_month)


def create_transaction(wallet, date, amount, **fields):
    return Transaction.objects.create(
        wallet=wallet, date=date, amount=Decimal(amount), description="Movement", **fields
    )


def create_transfer(from_wallet, to_wallet, date, amount):
    transfer = Transfer.objects.create()
    create_transaction(from_wallet, date, f"-{amount}", transfer=transfer)
    create_transaction(to_wallet, date, amount, transfer=transfer)
    return transfer


def member(user, transfers, shared_expenses, paid, suggested, wallets):
    return {
        "id": user.pk,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "transfers": transfers,
        "shared_expenses": shared_expenses,
        "paid": paid,
        "suggested": suggested,
        "wallets": [wallet.pk for wallet in wallets],
    }


@pytest.mark.django_db
class TestFamilyBalanceView:
    url = reverse("api:family-balance")

    def test_family_balance(self, anna_client, anna, bruno):
        contribution = create_contribution("2000")
        joint = create_wallet("Joint", [], is_shared=True)
        holiday = create_wallet("Holiday", [], is_shared=True)
        create_wallet("Old joint", [], is_shared=True, is_archived=True)
        anna_bank = create_wallet("Anna bank", [anna])
        bruno_bank = create_wallet("Bruno bank", [bruno])
        anna_cash = create_wallet("Anna cash", [anna])
        # Archived wallets cannot send the transfers anymore, but their past ones count
        bruno_old = create_wallet("Bruno old bank", [bruno], is_archived=True)
        create_transfer(bruno_old, joint, datetime.date(2026, 10, 3), "100.00")
        # Transfers to any joint wallet from the personal wallets
        create_transfer(anna_bank, joint, datetime.date(2026, 10, 2), "1000.00")
        create_transfer(anna_bank, holiday, datetime.date(2026, 11, 3), "200.00")
        create_transfer(bruno_bank, joint, datetime.date(2026, 11, 2), "1500.00")
        # Shared expenses net of the shared refunds; the others are ignored
        create_transaction(anna_bank, datetime.date(2026, 11, 5), "-300.00", is_shared=True)
        create_transaction(anna_bank, datetime.date(2026, 11, 6), "50.00", is_shared=True)
        create_transaction(anna_bank, datetime.date(2026, 11, 7), "-100.00")
        # Outside the period
        create_transaction(anna_bank, datetime.date(2026, 9, 30), "-80.00", is_shared=True)
        create_transaction(anna_bank, datetime.date(2026, 12, 1), "-80.00", is_shared=True)
        create_transfer(anna_bank, joint, datetime.date(2026, 12, 1), "80.00")
        # Not to a joint wallet, or not from a personal wallet of the same currency
        create_transfer(bruno_bank, anna_bank, datetime.date(2026, 11, 8), "80.00")
        create_transfer(holiday, joint, datetime.date(2026, 11, 8), "80.00")
        create_transaction(
            create_wallet("Bruno card", [bruno], "USD"), datetime.date(2026, 11, 8), "-8", is_shared=True
        )
        family = create_wallet("Family card", [anna, bruno])
        create_transaction(family, datetime.date(2026, 11, 8), "-80.00", is_shared=True)
        create_transfer(family, joint, datetime.date(2026, 11, 8), "80.00")
        # The expenses of the joint wallets are paid by everyone
        create_transaction(joint, datetime.date(2026, 11, 8), "-80.00", is_shared=True)

        response = anna_client.get(self.url, {"month": "2026-11"})

        assert response.status_code == 200
        assert response.json() == {
            "month": "2026-11",
            "currencies": [
                {
                    "id": contribution.pk,
                    "currency": "EUR",
                    "amount": "2000.00",
                    "start_month": "2026-10",
                    "months": 2,
                    "due": "2000.00",
                    "level": "2000.00",
                    "wallets": [{"id": holiday.pk, "name": "Holiday"}, {"id": joint.pk, "name": "Joint"}],
                    "members": [
                        member(anna, "1200.00", "250.00", "1450.00", "550.00", [anna_bank, anna_cash]),
                        member(bruno, "1600.00", "0.00", "1600.00", "400.00", [bruno_bank]),
                    ],
                },
            ],
        }

    def test_currencies_apart(self, anna_client, anna):
        create_contribution("100", currency="USD")
        create_contribution("100")
        create_transaction(create_wallet("Card", [anna], "USD"), datetime.date(2026, 11, 1), "-30", is_shared=True)

        response = anna_client.get(self.url, {"month": "2026-11"})

        assert [(item["currency"], item["members"][0]["paid"]) for item in response.json()["currencies"]] == [
            ("EUR", "0.00"),
            ("USD", "30.00"),
        ]

    def test_all_active_users_are_members(self, anna_client, anna, bruno):
        create_contribution("1000", start_month=datetime.date(2026, 11, 1))
        inactive = User.objects.create_user("old@example.com", is_active=False)
        create_transaction(create_wallet("Old bank", [inactive]), datetime.date(2026, 11, 1), "-30", is_shared=True)

        response = anna_client.get(self.url, {"month": "2026-11"})

        currency = response.json()["currencies"][0]
        assert currency["due"] == "500.00"
        assert [item["email"] for item in currency["members"]] == ["anna@example.com", "bruno@example.com"]

    def test_over_payer_raises_the_level(self, anna_client, anna, bruno):
        create_contribution()
        create_transaction(create_wallet("Anna bank", [anna]), datetime.date(2026, 10, 5), "-300", is_shared=True)

        response = anna_client.get(self.url, {"month": "2026-11"})

        currency = response.json()["currencies"][0]
        assert (currency["due"], currency["level"]) == ("0.00", "300.00")
        assert [(item["paid"], item["suggested"]) for item in currency["members"]] == [
            ("300.00", "0.00"),
            ("0.00", "300.00"),
        ]

    def test_due_rounded_to_cents(self, anna_client, anna, bruno, user):
        create_contribution("1000", start_month=datetime.date(2026, 11, 1))

        response = anna_client.get(self.url, {"month": "2026-11"})

        currency = response.json()["currencies"][0]
        assert currency["due"] == "333.33"
        assert {item["suggested"] for item in currency["members"]} == {"333.33"}

    def test_month_before_start(self, anna_client):
        create_contribution("1000", start_month=datetime.date(2026, 11, 1))

        response = anna_client.get(self.url, {"month": "2026-09"})

        currency = response.json()["currencies"][0]
        assert (currency["months"], currency["due"], currency["members"][0]["suggested"]) == (0, "0.00", "0.00")

    def test_default_month(self, anna_client):
        response = anna_client.get(self.url)

        assert response.json() == {"month": timezone.localdate().strftime("%Y-%m"), "currencies": []}

    def test_invalid_month(self, anna_client):
        response = anna_client.get(self.url, {"month": "november"})

        assert response.status_code == 400
        assert list(response.json()) == ["month"]

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403
