import datetime
from decimal import Decimal

import pytest
from django.db.models import ProtectedError
from django.urls import reverse
from django.utils import timezone

from core.models import Category, RecurringTransaction, Tag, Transaction, Wallet, add_months


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def wallet():
    return Wallet.objects.create(name="Bank")


def create_recurring(wallet, start_date=datetime.date(2026, 11, 1), next_date=None, **fields):
    tags = fields.pop("tags", [])
    fields.setdefault("amount", Decimal("-800.00"))
    fields.setdefault("description", "Rent")
    recurring = RecurringTransaction.objects.create(
        wallet=wallet, start_date=start_date, next_date=next_date or start_date, **fields
    )
    recurring.tags.set(tags)
    return recurring


@pytest.mark.parametrize(
    "day, months, expected",
    [
        (datetime.date(2026, 1, 15), 1, datetime.date(2026, 2, 15)),
        (datetime.date(2026, 1, 31), 1, datetime.date(2026, 2, 28)),
        (datetime.date(2028, 1, 31), 1, datetime.date(2028, 2, 29)),
        (datetime.date(2026, 11, 30), 3, datetime.date(2027, 2, 28)),
        (datetime.date(2026, 3, 31), -1, datetime.date(2026, 2, 28)),
        (datetime.date(2028, 2, 29), 12, datetime.date(2029, 2, 28)),
    ],
)
def test_add_months(day, months, expected):
    assert add_months(day, months) == expected


class TestRecurringTransactionSchedule:
    @pytest.mark.parametrize(
        "frequency, interval, expected",
        [
            ("weekly", 1, [datetime.date(2026, 1, 31), datetime.date(2026, 2, 7), datetime.date(2026, 2, 14)]),
            ("weekly", 2, [datetime.date(2026, 1, 31), datetime.date(2026, 2, 14), datetime.date(2026, 2, 28)]),
            # The day does not drift after a shorter month
            ("monthly", 1, [datetime.date(2026, 1, 31), datetime.date(2026, 2, 28), datetime.date(2026, 3, 31)]),
            ("monthly", 3, [datetime.date(2026, 1, 31), datetime.date(2026, 4, 30), datetime.date(2026, 7, 31)]),
            ("yearly", 1, [datetime.date(2026, 1, 31), datetime.date(2027, 1, 31), datetime.date(2028, 1, 31)]),
        ],
    )
    def test_occurrences(self, frequency, interval, expected):
        recurring = RecurringTransaction(frequency=frequency, interval=interval, start_date=datetime.date(2026, 1, 31))

        assert [recurring.occurrence(index) for index in range(3)] == expected

    def test_occurrence_after(self):
        recurring = RecurringTransaction(start_date=datetime.date(2026, 1, 31))

        assert recurring.occurrence_after(datetime.date(2025, 6, 1)) == datetime.date(2026, 1, 31)
        assert recurring.occurrence_after(datetime.date(2026, 2, 27)) == datetime.date(2026, 2, 28)
        assert recurring.occurrence_after(datetime.date(2026, 2, 28)) == datetime.date(2026, 3, 31)

    def test_reschedule(self):
        recurring = RecurringTransaction(start_date=datetime.date(2026, 1, 10), next_date=datetime.date(2026, 3, 10))

        recurring.reschedule()
        assert recurring.next_date == datetime.date(2026, 3, 10)

        recurring.start_date = datetime.date(2026, 1, 5)
        recurring.reschedule()
        assert recurring.next_date == datetime.date(2026, 4, 5)

    def test_is_ended(self):
        recurring = RecurringTransaction(next_date=datetime.date(2026, 3, 1))

        assert not recurring.is_ended
        recurring.end_date = datetime.date(2026, 3, 1)
        assert not recurring.is_ended
        recurring.end_date = datetime.date(2026, 2, 28)
        assert recurring.is_ended

    def test_str(self):
        assert str(RecurringTransaction(description="Rent", amount=Decimal("-800.00"))) == "Rent -800.00"


@pytest.mark.django_db
class TestRecurringTransactionModel:
    def test_wallet_protected(self, wallet):
        create_recurring(wallet)

        with pytest.raises(ProtectedError):
            wallet.delete()

    def test_category_deleted(self, wallet):
        category = Category.objects.create(name="Home")
        recurring = create_recurring(wallet, category=category)

        category.delete()

        recurring.refresh_from_db()
        assert recurring.category is None


@pytest.mark.django_db
class TestRecurringTransactionListView:
    url = reverse("api:recurring-transactions")

    def test_list(self, user_client, wallet):
        category = Category.objects.create(name="Home")
        tag = Tag.objects.create(name="house")
        later = create_recurring(wallet, start_date=datetime.date(2026, 12, 1))
        recurring = create_recurring(
            wallet,
            start_date=datetime.date(2026, 1, 27),
            next_date=datetime.date(2026, 11, 27),
            amount="2500.00",
            description="Salary",
            category=category,
            tags=[tag],
            notes="Net",
            end_date=datetime.date(2027, 12, 31),
        )

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [recurring.pk, later.pk]
        assert response.json()[0] == {
            "id": recurring.pk,
            "wallet": wallet.pk,
            "amount": "2500.00",
            "description": "Salary",
            "category": category.pk,
            "tags": [tag.pk],
            "notes": "Net",
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-27",
            "end_date": "2027-12-31",
            "next_date": "2026-11-27",
            "is_ended": False,
            "created_at": recurring.created_at.isoformat().replace("+00:00", "Z"),
        }

    def test_create(self, user_client, wallet):
        tag = Tag.objects.create(name="car")

        response = user_client.post(
            self.url,
            {
                "wallet": wallet.pk,
                "amount": "-120.5",
                "description": "Insurance",
                "tags": [tag.pk],
                "frequency": "yearly",
                "start_date": "2027-03-15",
            },
            format="json",
        )

        assert response.status_code == 201
        recurring = RecurringTransaction.objects.get()
        assert response.json()["id"] == recurring.pk
        assert response.json()["next_date"] == "2027-03-15"
        assert (recurring.amount, recurring.interval, recurring.end_date) == (Decimal("-120.50"), 1, None)
        assert list(recurring.tags.all()) == [tag]
        # It is not a real transaction
        assert not Transaction.objects.exists()

    def test_create_ignores_next_date(self, user_client, wallet):
        response = user_client.post(
            self.url,
            {
                "wallet": wallet.pk,
                "amount": "-1",
                "description": "x",
                "start_date": "2026-11-01",
                "next_date": "2030-01-01",
            },
            format="json",
        )

        assert response.json()["next_date"] == "2026-11-01"

    def test_create_missing_fields(self, user_client):
        response = user_client.post(self.url, {}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"wallet", "amount", "description", "start_date"}

    @pytest.mark.parametrize(
        "fields, errors",
        [
            ({"amount": "0"}, {"amount": ["The amount cannot be zero."]}),
            ({"interval": 0}, {"interval": ["Ensure this value is greater than or equal to 1."]}),
            ({"frequency": "daily"}, {"frequency": ['"daily" is not a valid choice.']}),
            ({"end_date": "2026-10-31"}, {"end_date": ["The end date cannot precede the start date."]}),
        ],
    )
    def test_create_invalid(self, user_client, wallet, fields, errors):
        data = {"wallet": wallet.pk, "amount": "-1", "description": "x", "start_date": "2026-11-01"}

        response = user_client.post(self.url, data | fields, format="json")

        assert response.status_code == 400
        assert response.json() == errors

    def test_create_on_archived_wallet(self, user_client):
        old = Wallet.objects.create(name="Old", is_archived=True)

        response = user_client.post(
            self.url,
            {"wallet": old.pk, "amount": "-1", "description": "x", "start_date": "2026-11-01"},
            format="json",
        )

        assert response.status_code == 400
        assert response.json() == {"wallet": ["This wallet is archived."]}

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403


@pytest.mark.django_db
class TestRecurringTransactionDetailView:
    @staticmethod
    def url(recurring):
        return reverse("api:recurring-transaction", args=[recurring.pk])

    def test_retrieve(self, user_client, wallet):
        recurring = create_recurring(wallet)

        response = user_client.get(self.url(recurring))

        assert response.status_code == 200
        assert response.json()["description"] == "Rent"

    def test_update_keeps_the_handled_occurrences(self, user_client, wallet):
        # November and December have been handled already
        recurring = create_recurring(wallet, next_date=datetime.date(2027, 1, 1))

        response = user_client.patch(self.url(recurring), {"start_date": "2026-11-05"}, format="json")

        assert response.status_code == 200
        assert response.json()["next_date"] == "2027-01-05"

    def test_update_frequency(self, user_client, wallet):
        recurring = create_recurring(wallet, next_date=datetime.date(2027, 1, 1))

        response = user_client.patch(self.url(recurring), {"frequency": "yearly", "tags": []}, format="json")

        assert response.json()["next_date"] == "2027-11-01"

    def test_update_end_date_before_start(self, user_client, wallet):
        recurring = create_recurring(wallet)

        response = user_client.patch(self.url(recurring), {"end_date": "2026-10-01"}, format="json")

        assert response.status_code == 400
        assert response.json() == {"end_date": ["The end date cannot precede the start date."]}

    def test_update_on_archived_wallet(self, user_client, wallet):
        recurring = create_recurring(wallet)
        wallet.is_archived = True
        wallet.save()

        response = user_client.patch(self.url(recurring), {"amount": "-900"}, format="json")

        assert response.status_code == 200
        assert response.json()["amount"] == "-900.00"

    def test_delete(self, user_client, wallet):
        recurring = create_recurring(wallet)

        response = user_client.delete(self.url(recurring))

        assert response.status_code == 204
        assert not RecurringTransaction.objects.exists()

    def test_anonymous(self, api_client, wallet):
        response = api_client.get(self.url(create_recurring(wallet)))

        assert response.status_code == 403


@pytest.mark.django_db
class TestRecurringTransactionDueView:
    url = reverse("api:recurring-transactions-due")

    def test_due(self, user_client, wallet):
        today = timezone.localdate()
        overdue = create_recurring(wallet, start_date=today - datetime.timedelta(days=40))
        soon = create_recurring(wallet, start_date=today + datetime.timedelta(days=7))
        # Too far away
        create_recurring(wallet, start_date=today + datetime.timedelta(days=8))
        # Ended
        create_recurring(
            wallet,
            start_date=today - datetime.timedelta(days=60),
            next_date=today - datetime.timedelta(days=1),
            end_date=today - datetime.timedelta(days=2),
        )
        # On an archived wallet
        create_recurring(Wallet.objects.create(name="Old", is_archived=True), start_date=today)
        ending = create_recurring(wallet, start_date=today, end_date=today)

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [overdue.pk, ending.pk, soon.pk]

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403


@pytest.mark.django_db
class TestRecurringTransactionSkipView:
    @staticmethod
    def url(recurring):
        return reverse("api:recurring-transaction-skip", args=[recurring.pk])

    def test_skip(self, user_client, wallet):
        recurring = create_recurring(
            wallet, start_date=datetime.date(2026, 1, 31), next_date=datetime.date(2026, 2, 28)
        )

        response = user_client.post(self.url(recurring))

        assert response.status_code == 200
        assert response.json()["next_date"] == "2026-03-31"
        recurring.refresh_from_db()
        assert recurring.next_date == datetime.date(2026, 3, 31)
        assert not Transaction.objects.exists()

    def test_skip_the_last_occurrence(self, user_client, wallet):
        recurring = create_recurring(wallet, end_date=datetime.date(2026, 11, 30))

        response = user_client.post(self.url(recurring))
        assert response.json()["is_ended"] is True

        response = user_client.post(self.url(recurring))
        assert response.status_code == 400
        assert response.json() == ["This recurring transaction has ended."]

    def test_not_found(self, user_client):
        response = user_client.post(reverse("api:recurring-transaction-skip", args=[1]))

        assert response.status_code == 404

    def test_anonymous(self, api_client, wallet):
        response = api_client.post(self.url(create_recurring(wallet)))

        assert response.status_code == 403


@pytest.mark.django_db
class TestRegisterOccurrence:
    url = reverse("api:transactions")

    def test_register(self, user_client, wallet):
        recurring = create_recurring(wallet)

        response = user_client.post(
            self.url,
            {
                "wallet": wallet.pk,
                "date": "2026-11-02",
                "amount": "-810",
                "description": "Rent",
                "recurring_transaction": recurring.pk,
            },
            format="json",
        )

        assert response.status_code == 201
        assert response.json()["recurring_transaction"] == recurring.pk
        item = Transaction.objects.get()
        assert (item.amount, item.recurring_transaction) == (Decimal("-810.00"), recurring)
        recurring.refresh_from_db()
        assert recurring.next_date == datetime.date(2026, 12, 1)

    def test_register_invalid_transaction(self, user_client, wallet):
        recurring = create_recurring(wallet)

        response = user_client.post(
            self.url,
            {"wallet": wallet.pk, "date": "2026-11-02", "amount": "0", "recurring_transaction": recurring.pk},
            format="json",
        )

        assert response.status_code == 400
        recurring.refresh_from_db()
        assert recurring.next_date == datetime.date(2026, 11, 1)

    def test_register_ended(self, user_client, wallet):
        recurring = create_recurring(wallet, next_date=datetime.date(2026, 12, 1), end_date=datetime.date(2026, 11, 30))

        response = user_client.post(
            self.url,
            {
                "wallet": wallet.pk,
                "date": "2026-12-01",
                "amount": "-800",
                "description": "Rent",
                "recurring_transaction": recurring.pk,
            },
            format="json",
        )

        assert response.status_code == 400
        assert response.json() == {"recurring_transaction": ["This recurring transaction has ended."]}
        assert not Transaction.objects.exists()

    def test_create_without_recurring_transaction(self, user_client, wallet):
        recurring = create_recurring(wallet)

        response = user_client.post(
            self.url,
            {
                "wallet": wallet.pk,
                "date": "2026-11-02",
                "amount": "-5",
                "description": "Coffee",
                "recurring_transaction": None,
            },
            format="json",
        )

        assert response.status_code == 201
        assert response.json()["recurring_transaction"] is None
        recurring.refresh_from_db()
        assert recurring.next_date == datetime.date(2026, 11, 1)

    def test_deleting_the_recurring_transaction_keeps_the_transactions(self, user_client, wallet):
        recurring = create_recurring(wallet)
        item = Transaction.objects.create(
            wallet=wallet,
            date=datetime.date(2026, 11, 1),
            amount=-800,
            description="Rent",
            recurring_transaction=recurring,
        )

        user_client.delete(reverse("api:recurring-transaction", args=[recurring.pk]))

        item.refresh_from_db()
        assert item.recurring_transaction is None

    def test_update_ignores_the_recurring_transaction(self, user_client, wallet):
        recurring = create_recurring(wallet)
        item = Transaction.objects.create(wallet=wallet, date=datetime.date(2026, 11, 1), amount=-1, description="x")

        response = user_client.patch(
            reverse("api:transaction", args=[item.pk]),
            {"amount": "-2", "recurring_transaction": recurring.pk},
            format="json",
        )

        # The link is set only when the transaction registers the occurrence
        assert response.status_code == 200
        assert response.json()["recurring_transaction"] is None
        recurring.refresh_from_db()
        assert recurring.next_date == datetime.date(2026, 11, 1)
