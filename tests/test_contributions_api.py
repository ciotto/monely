import datetime
from decimal import Decimal

import pytest
from django.urls import reverse

from core.models import Contribution


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def contribution():
    return Contribution.objects.create(currency="EUR", amount=Decimal("2000"), start_month=datetime.date(2026, 10, 1))


@pytest.mark.django_db
class TestContributionListView:
    url = reverse("api:contributions")

    def test_list(self, user_client, contribution):
        Contribution.objects.create(currency="CHF", amount=Decimal("100"), start_month=datetime.date(2026, 1, 1))

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert [item["currency"] for item in response.json()] == ["CHF", "EUR"]
        assert response.json()[1] == {
            "id": contribution.pk,
            "currency": "EUR",
            "amount": "2000.00",
            "start_month": "2026-10",
            "created_at": contribution.created_at.isoformat().replace("+00:00", "Z"),
        }

    @pytest.mark.parametrize("start_month", ["2026-10", "2026-10-15"])
    def test_create(self, user_client, start_month):
        response = user_client.post(
            self.url, {"currency": "EUR", "amount": "1500", "start_month": start_month}, format="json"
        )

        assert response.status_code == 201
        contribution = Contribution.objects.get()
        # Always the first day of the month
        assert (contribution.amount, contribution.start_month) == (Decimal("1500.00"), datetime.date(2026, 10, 1))

    def test_create_zero(self, user_client):
        response = user_client.post(
            self.url, {"currency": "EUR", "amount": "0", "start_month": "2026-10"}, format="json"
        )

        assert response.status_code == 201

    def test_create_duplicate_currency(self, user_client, contribution):
        response = user_client.post(
            self.url, {"currency": "EUR", "amount": "10", "start_month": "2026-10"}, format="json"
        )

        assert response.status_code == 400
        assert response.json() == {"currency": ["This currency already has a family contribution."]}

    def test_create_invalid(self, user_client):
        response = user_client.post(self.url, {"currency": "eur", "amount": "-1"}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"currency", "amount", "start_month"}

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403


@pytest.mark.django_db
class TestContributionDetailView:
    @staticmethod
    def url(contribution):
        return reverse("api:contribution", args=[contribution.pk])

    def test_update_keeps_its_currency(self, user_client, contribution):
        response = user_client.patch(self.url(contribution), {"currency": "EUR", "amount": "2500"}, format="json")

        assert response.status_code == 200
        contribution.refresh_from_db()
        assert contribution.amount == Decimal("2500.00")

    def test_delete(self, user_client, contribution):
        response = user_client.delete(self.url(contribution))

        assert response.status_code == 204
        assert not Contribution.objects.exists()
