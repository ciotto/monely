import datetime
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from core.models import Budget, Category, RecurringTransaction, Transaction, Transfer, Wallet


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def groceries():
    return Category.objects.create(name="Groceries")


@pytest.fixture
def car():
    return Category.objects.create(name="car")


@pytest.fixture
def wallet():
    return Wallet.objects.create(name="Bank")


def create_transaction(wallet, date, amount, category, **fields):
    return Transaction.objects.create(
        wallet=wallet, date=date, amount=Decimal(amount), description="Movement", category=category, **fields
    )


def create_recurring(wallet, category, amount, start_date, **fields):
    return RecurringTransaction.objects.create(
        wallet=wallet,
        category=category,
        amount=Decimal(amount),
        description=fields.pop("description", "Insurance"),
        start_date=start_date,
        next_date=start_date,
        **fields,
    )


@pytest.mark.django_db
class TestBudgetApi:
    list_url = reverse("api:budgets")

    def test_list(self, user_client, groceries, car):
        Budget.objects.create(category=groceries, currency="USD", amount=50)
        Budget.objects.create(category=groceries, amount=300)
        Budget.objects.create(category=car, amount=150)

        response = user_client.get(self.list_url)

        assert response.status_code == 200
        # By currency, then by category name regardless of the case
        assert [(item["currency"], item["category"]) for item in response.json()] == [
            ("EUR", car.pk),
            ("EUR", groceries.pk),
            ("USD", groceries.pk),
        ]
        assert set(response.json()[0]) == {"id", "category", "currency", "amount", "created_at"}
        assert response.json()[0]["amount"] == "150.00"

    def test_list_anonymous(self, api_client):
        response = api_client.get(self.list_url)

        assert response.status_code == 403

    def test_create(self, user_client, groceries):
        response = user_client.post(self.list_url, {"category": groceries.pk, "amount": "300"}, format="json")

        assert response.status_code == 201
        budget = Budget.objects.get()
        assert response.json()["id"] == budget.pk
        assert budget.category == groceries
        assert budget.currency == "EUR"
        assert budget.amount == Decimal("300.00")

    def test_create_other_currency(self, user_client, groceries):
        Budget.objects.create(category=groceries, amount=300)

        response = user_client.post(
            self.list_url, {"category": groceries.pk, "currency": "USD", "amount": "50"}, format="json"
        )

        assert response.status_code == 201
        assert Budget.objects.count() == 2

    def test_create_duplicate(self, user_client, groceries):
        Budget.objects.create(category=groceries, amount=300)

        response = user_client.post(self.list_url, {"category": groceries.pk, "amount": "100"}, format="json")

        assert response.status_code == 400
        assert response.json() == {"category": ["This category already has a budget in this currency."]}

    @pytest.mark.parametrize(
        "data, field",
        [
            ({"amount": "0"}, "amount"),
            ({"amount": "-10"}, "amount"),
            ({"amount": ""}, "amount"),
            ({"currency": "eur"}, "currency"),
            ({"category": None}, "category"),
        ],
    )
    def test_create_invalid(self, user_client, groceries, data, field):
        response = user_client.post(self.list_url, {"category": groceries.pk, "amount": "300", **data}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {field}

    def test_update(self, user_client, groceries):
        budget = Budget.objects.create(category=groceries, amount=300)

        response = user_client.patch(reverse("api:budget", args=[budget.pk]), {"amount": "350.50"}, format="json")

        assert response.status_code == 200
        budget.refresh_from_db()
        assert budget.amount == Decimal("350.50")

    def test_update_duplicate(self, user_client, groceries, car):
        Budget.objects.create(category=groceries, amount=300)
        budget = Budget.objects.create(category=car, amount=150)

        response = user_client.patch(reverse("api:budget", args=[budget.pk]), {"category": groceries.pk}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"category"}

    def test_delete(self, user_client, groceries):
        budget = Budget.objects.create(category=groceries, amount=300)

        response = user_client.delete(reverse("api:budget", args=[budget.pk]))

        assert response.status_code == 204
        assert not Budget.objects.exists()
        # The category is kept
        assert Category.objects.exists()


@pytest.mark.django_db
class TestBudgetSummaryView:
    url = reverse("api:budgets-summary")

    def test_month(self, user_client, wallet, groceries, car):
        groceries_budget = Budget.objects.create(category=groceries, amount=300)
        car_budget = Budget.objects.create(category=car, amount=150)
        create_transaction(wallet, datetime.date(2026, 11, 1), "-40.00", groceries)
        create_transaction(wallet, datetime.date(2026, 11, 30), "-62.30", groceries)
        # Refunds reduce the expenses
        create_transaction(wallet, datetime.date(2026, 11, 16), "5", groceries)
        # Other months, other categories and transfers do not count
        create_transaction(wallet, datetime.date(2026, 10, 31), "-100", groceries)
        create_transaction(wallet, datetime.date(2026, 12, 1), "-100", groceries)
        create_transaction(wallet, datetime.date(2026, 11, 10), "-100", None)
        create_transaction(wallet, datetime.date(2026, 11, 10), "-20", car)
        create_transaction(wallet, datetime.date(2026, 11, 10), "-100", None, transfer=Transfer.objects.create())

        response = user_client.get(self.url, {"month": "2026-11"})

        assert response.status_code == 200
        assert response.json() == {
            "month": "2026-11",
            "budgets": [
                {
                    "id": car_budget.pk,
                    "category": car.pk,
                    "currency": "EUR",
                    "amount": "150.00",
                    "transactions": "20.00",
                    "recurring": "0.00",
                    "spent": "20.00",
                    "remaining": "130.00",
                    "recurring_transactions": [],
                },
                {
                    "id": groceries_budget.pk,
                    "category": groceries.pk,
                    "currency": "EUR",
                    "amount": "300.00",
                    "transactions": "97.30",
                    "recurring": "0.00",
                    "spent": "97.30",
                    "remaining": "202.70",
                    "recurring_transactions": [],
                },
            ],
        }

    @pytest.mark.parametrize("month", ["2026-03", "2026-04", "2027-02"])
    def test_recurring_spread_over_the_months(self, user_client, wallet, car, month):
        """A yearly insurance paid in March weighs on every month, also in the following ones."""
        Budget.objects.create(category=car, amount=150)
        recurring = create_recurring(wallet, car, "-1200", datetime.date(2026, 3, 10), frequency="yearly")
        # The registered occurrence is already counted by the share
        create_transaction(wallet, datetime.date(2026, 3, 10), "-1200", car, recurring_transaction=recurring)
        create_transaction(wallet, datetime.date(2026, 3, 20), "-30", car)

        budget = user_client.get(self.url, {"month": month}).json()["budgets"][0]

        assert budget["recurring"] == "100.00"
        assert budget["recurring_transactions"] == [{"id": recurring.pk, "description": "Insurance", "share": "100.00"}]
        if month == "2026-03":
            assert (budget["transactions"], budget["spent"], budget["remaining"]) == ("30.00", "130.00", "20.00")
        else:
            assert (budget["transactions"], budget["spent"], budget["remaining"]) == ("0.00", "100.00", "50.00")

    @pytest.mark.parametrize(
        "month, counted",
        [("2026-02", False), ("2026-03", True), ("2026-06", True), ("2026-07", False)],
    )
    def test_recurring_between_start_and_end(self, user_client, wallet, car, month, counted):
        Budget.objects.create(category=car, amount=150)
        create_recurring(
            wallet, car, "-60", datetime.date(2026, 3, 31), frequency="monthly", end_date=datetime.date(2026, 6, 1)
        )

        budget = user_client.get(self.url, {"month": month}).json()["budgets"][0]

        assert budget["recurring"] == ("60.00" if counted else "0.00")

    def test_recurring_by_category_and_currency(self, user_client, wallet, groceries, car):
        Budget.objects.create(category=car, amount=500)
        dollars = Wallet.objects.create(name="US account", currency="USD")
        start = datetime.date(2026, 1, 1)
        create_recurring(wallet, car, "-30", start, frequency="weekly", description="Parking")
        create_recurring(wallet, car, "-100", start, frequency="monthly", interval=3, description="Fuel card")
        # A refund lowers the expenses
        create_recurring(wallet, car, "10", start, frequency="monthly", description="Car sharing")
        create_recurring(wallet, groceries, "-100", start)
        create_recurring(wallet, None, "-100", start)
        create_recurring(dollars, car, "-100", start)

        budget = user_client.get(self.url, {"month": "2026-11"}).json()["budgets"][0]

        assert budget["recurring_transactions"] == [
            {
                "id": RecurringTransaction.objects.get(description="Car sharing").pk,
                "description": "Car sharing",
                "share": "-10.00",
            },
            {
                "id": RecurringTransaction.objects.get(description="Fuel card").pk,
                "description": "Fuel card",
                "share": "33.33",
            },
            {
                "id": RecurringTransaction.objects.get(description="Parking").pk,
                "description": "Parking",
                "share": "130.00",
            },
        ]
        assert (budget["recurring"], budget["spent"], budget["remaining"]) == ("153.33", "153.33", "346.67")

    def test_current_month(self, user_client, wallet, groceries):
        Budget.objects.create(category=groceries, amount=300)
        create_transaction(wallet, timezone.localdate(), "-10", groceries)

        response = user_client.get(self.url)

        assert response.json()["month"] == timezone.localdate().strftime("%Y-%m")
        assert response.json()["budgets"][0]["spent"] == "10.00"

    def test_overspent(self, user_client, wallet, groceries):
        Budget.objects.create(category=groceries, amount=100)
        create_transaction(wallet, datetime.date(2026, 11, 1), "-120.50", groceries)

        budget = user_client.get(self.url, {"month": "2026-11"}).json()["budgets"][0]

        assert budget["remaining"] == "-20.50"

    def test_invalid_month(self, user_client):
        response = user_client.get(self.url, {"month": "2026-13"})

        assert response.status_code == 400
        assert set(response.json()) == {"month"}

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403
