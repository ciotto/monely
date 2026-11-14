import datetime
from decimal import Decimal

import pytest
from django.urls import reverse

from core.models import Budget, Category, Transaction, Wallet
from core.reports import add_months


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    return api_client


@pytest.fixture
def wallet():
    return Wallet.objects.create(name="Bank")


@pytest.fixture
def groceries():
    return Category.objects.create(name="Groceries")


@pytest.fixture
def salary():
    return Category.objects.create(name="Salary")


def create_transaction(wallet, date, amount, category=None):
    return Transaction.objects.create(
        wallet=wallet, date=date, amount=Decimal(amount), description="Movement", category=category
    )


@pytest.mark.parametrize(
    "month,months,expected",
    [
        (datetime.date(2026, 11, 1), 1, datetime.date(2026, 12, 1)),
        (datetime.date(2026, 12, 1), 1, datetime.date(2027, 1, 1)),
        (datetime.date(2026, 1, 1), -1, datetime.date(2025, 12, 1)),
        (datetime.date(2026, 11, 1), -12, datetime.date(2025, 11, 1)),
    ],
)
def test_add_months(month, months, expected):
    assert add_months(month, months) == expected


@pytest.mark.django_db
class TestDashboardView:
    url = reverse("api:dashboard")

    def test_month(self, user_client, wallet, groceries, salary):
        create_transaction(wallet, datetime.date(2026, 11, 1), "-40.00", groceries)
        create_transaction(wallet, datetime.date(2026, 11, 30), "-2.30", groceries)
        create_transaction(wallet, datetime.date(2026, 11, 27), "1500", salary)
        create_transaction(wallet, datetime.date(2026, 11, 15), "-10")
        # A refund in the same category counts as income
        create_transaction(wallet, datetime.date(2026, 11, 16), "5", groceries)
        # The same month of the previous year
        create_transaction(wallet, datetime.date(2025, 11, 10), "-30", groceries)
        create_transaction(wallet, datetime.date(2025, 11, 10), "1400", salary)
        # The previous month
        create_transaction(wallet, datetime.date(2026, 10, 31), "-100", groceries)
        # Other months
        create_transaction(wallet, datetime.date(2026, 9, 30), "-100", groceries)
        create_transaction(wallet, datetime.date(2026, 12, 1), "-100", groceries)

        response = user_client.get(self.url, {"month": "2026-11"})

        assert response.status_code == 200
        assert response.json() == {
            "month": "2026-11",
            "previous_month": "2026-10",
            "previous_year": "2025-11",
            "currencies": [
                {
                    "currency": "EUR",
                    "income": "1505.00",
                    "expenses": "-52.30",
                    "net": "1452.70",
                    "previous_year": {"income": "1400.00", "expenses": "-30.00", "net": "1370.00"},
                    "categories": [
                        {
                            "category": groceries.pk,
                            "income": "5.00",
                            "expenses": "-42.30",
                            "previous_month_income": "0.00",
                            "previous_month_expenses": "-100.00",
                            "previous_year_income": "0.00",
                            "previous_year_expenses": "-30.00",
                        },
                        {
                            "category": salary.pk,
                            "income": "1500.00",
                            "expenses": "0.00",
                            "previous_month_income": "0.00",
                            "previous_month_expenses": "0.00",
                            "previous_year_income": "1400.00",
                            "previous_year_expenses": "0.00",
                        },
                        {
                            "category": None,
                            "income": "0.00",
                            "expenses": "-10.00",
                            "previous_month_income": "0.00",
                            "previous_month_expenses": "0.00",
                            "previous_year_income": "0.00",
                            "previous_year_expenses": "0.00",
                        },
                    ],
                    "budgets": [],
                }
            ],
            # The balance includes everything up to the end of the month
            "wallets": [{"id": wallet.pk, "name": "Bank", "currency": "EUR", "balance": "2622.70"}],
        }

    def test_current_month_by_default(self, user_client, wallet, monkeypatch):
        monkeypatch.setattr("django.utils.timezone.localdate", lambda: datetime.date(2026, 3, 15))
        create_transaction(wallet, datetime.date(2026, 3, 1), "-5")

        response = user_client.get(self.url)

        assert response.json()["month"] == "2026-03"
        assert response.json()["currencies"][0]["expenses"] == "-5.00"

    def test_empty(self, user_client):
        response = user_client.get(self.url, {"month": "2026-11"})

        assert response.json() == {
            "month": "2026-11",
            "previous_month": "2026-10",
            "previous_year": "2025-11",
            "currencies": [],
            "wallets": [],
        }

    def test_wallet_without_transactions(self, user_client, wallet):
        response = user_client.get(self.url, {"month": "2026-11"})

        assert response.json()["currencies"] == [
            {
                "currency": "EUR",
                "income": "0.00",
                "expenses": "0.00",
                "net": "0.00",
                "previous_year": {"income": "0.00", "expenses": "0.00", "net": "0.00"},
                "categories": [],
                "budgets": [],
            }
        ]
        assert response.json()["wallets"][0]["balance"] == "0.00"

    def test_totals_by_currency(self, user_client, wallet):
        dollars = Wallet.objects.create(name="US account", currency="USD")
        create_transaction(wallet, datetime.date(2026, 11, 2), "-10")
        create_transaction(dollars, datetime.date(2026, 11, 2), "-20")

        response = user_client.get(self.url, {"month": "2026-11"})

        assert [(item["currency"], item["expenses"]) for item in response.json()["currencies"]] == [
            ("EUR", "-10.00"),
            ("USD", "-20.00"),
        ]
        assert [item["name"] for item in response.json()["wallets"]] == ["Bank", "US account"]

    def test_archived_wallets(self, user_client, wallet):
        # Their transactions count, but they are not listed among the balances
        archived = Wallet.objects.create(name="Old card", currency="USD", is_archived=True)
        create_transaction(archived, datetime.date(2026, 11, 2), "-20")

        response = user_client.get(self.url, {"month": "2026-11"})

        assert [item["currency"] for item in response.json()["currencies"]] == ["EUR", "USD"]
        assert [item["name"] for item in response.json()["wallets"]] == ["Bank"]

    def test_only_previous_year(self, user_client, wallet, groceries):
        create_transaction(wallet, datetime.date(2025, 11, 2), "-20", groceries)

        response = user_client.get(self.url, {"month": "2026-11"})

        summary = response.json()["currencies"][0]
        assert summary["expenses"] == "0.00"
        assert summary["previous_year"]["expenses"] == "-20.00"
        assert summary["categories"][0]["category"] == groceries.pk

    def test_only_previous_month(self, user_client, wallet, groceries):
        create_transaction(wallet, datetime.date(2026, 1, 31), "-20", groceries)

        response = user_client.get(self.url, {"month": "2026-02"})

        summary = response.json()["currencies"][0]
        assert response.json()["previous_month"] == "2026-01"
        assert summary["expenses"] == "0.00"
        assert summary["categories"] == [
            {
                "category": groceries.pk,
                "income": "0.00",
                "expenses": "0.00",
                "previous_month_income": "0.00",
                "previous_month_expenses": "-20.00",
                "previous_year_income": "0.00",
                "previous_year_expenses": "0.00",
            }
        ]

    def test_filter_by_wallet(self, user_client, wallet):
        archived = Wallet.objects.create(name="Old card", currency="USD", is_archived=True)
        create_transaction(wallet, datetime.date(2026, 11, 2), "-10")
        create_transaction(archived, datetime.date(2026, 11, 2), "-20")

        response = user_client.get(self.url, {"month": "2026-11", "wallet": archived.pk})

        assert [(item["currency"], item["expenses"]) for item in response.json()["currencies"]] == [("USD", "-20.00")]
        # A chosen wallet is listed even when archived
        assert response.json()["wallets"] == [
            {"id": archived.pk, "name": "Old card", "currency": "USD", "balance": "-20.00"}
        ]

    def test_budgets_by_currency(self, user_client, wallet, groceries):
        Wallet.objects.create(name="US account", currency="USD")
        Budget.objects.create(category=groceries, amount=300)
        Budget.objects.create(category=groceries, currency="USD", amount=50)
        # A currency without wallets nor transactions is shown for its budgets
        Budget.objects.create(category=groceries, currency="GBP", amount=20)
        create_transaction(wallet, datetime.date(2026, 11, 2), "-40", groceries)

        response = user_client.get(self.url, {"month": "2026-11"})

        budgets = {item["currency"]: item["budgets"] for item in response.json()["currencies"]}
        assert [(budget["currency"], budget["spent"]) for budget in budgets["EUR"]] == [("EUR", "40.00")]
        assert [(budget["currency"], budget["amount"]) for budget in budgets["USD"]] == [("USD", "50.00")]
        assert [(budget["currency"], budget["amount"]) for budget in budgets["GBP"]] == [("GBP", "20.00")]
        assert set(budgets["EUR"][0]) == {
            "id",
            "category",
            "currency",
            "amount",
            "transactions",
            "recurring",
            "spent",
            "remaining",
            "recurring_transactions",
        }

    def test_budgets_left_out_for_a_wallet(self, user_client, wallet, groceries):
        """The budgets cover all the wallets, so they would not match the totals of one."""
        Budget.objects.create(category=groceries, amount=300)
        Budget.objects.create(category=groceries, currency="USD", amount=50)

        response = user_client.get(self.url, {"month": "2026-11", "wallet": wallet.pk})

        assert [(item["currency"], item["budgets"]) for item in response.json()["currencies"]] == [("EUR", [])]

    @pytest.mark.parametrize(
        "params,field", [({"month": "2026-13"}, "month"), ({"month": "11/2026"}, "month"), ({"wallet": 999}, "wallet")]
    )
    def test_invalid_filter(self, user_client, params, field):
        response = user_client.get(self.url, params)

        assert response.status_code == 400
        assert set(response.json()) == {field}

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403
