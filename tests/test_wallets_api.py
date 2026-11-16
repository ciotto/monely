import pytest
from django.urls import reverse

from core.models import User, Wallet


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.fixture
def wallet(user):
    wallet = Wallet.objects.create(name="Bank", currency="EUR")
    wallet.owners.set([user])
    return wallet


@pytest.mark.django_db
class TestWalletListView:
    url = reverse("api:wallets")

    def test_list(self, user_client, user, wallet):
        archived = Wallet.objects.create(name="Old account", currency="USD", is_archived=True)
        archived.owners.set([user])
        Wallet.objects.create(name="Cash")

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert [item["name"] for item in response.json()] == ["Bank", "Cash", "Old account"]
        assert response.json()[0] == {
            "id": wallet.pk,
            "name": "Bank",
            "currency": "EUR",
            "owners": [user.pk],
            "is_archived": False,
            "is_shared": False,
            "created_at": wallet.created_at.isoformat().replace("+00:00", "Z"),
        }

    def test_list_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403


@pytest.mark.django_db
class TestWalletCreate:
    url = reverse("api:wallets")

    def test_create(self, user_client, user):
        response = user_client.post(self.url, {"name": "Card", "currency": "USD", "owners": [user.pk]}, format="json")

        assert response.status_code == 201
        wallet = Wallet.objects.get()
        assert response.json()["id"] == wallet.pk
        assert wallet.name == "Card"
        assert wallet.currency == "USD"
        assert list(wallet.owners.all()) == [user]
        assert not wallet.is_archived
        assert not wallet.is_shared

    def test_create_joint(self, user_client, user):
        response = user_client.post(
            self.url, {"name": "Joint account", "owners": [user.pk], "is_shared": True}, format="json"
        )

        assert response.status_code == 201
        assert response.json()["owners"] == []
        wallet = Wallet.objects.get()
        assert wallet.is_shared
        # It belongs to the whole family
        assert not wallet.owners.exists()

    def test_create_with_many_owners(self, user_client, user):
        other = User.objects.create_user("luca@example.com")

        response = user_client.post(self.url, {"name": "Bank", "owners": [user.pk, other.pk]}, format="json")

        assert response.status_code == 400
        assert response.json() == {"owners": ["A personal wallet has exactly one owner."]}

    def test_create_default_currency(self, user_client, user):
        response = user_client.post(self.url, {"name": "Cash", "owners": [user.pk]}, format="json")

        assert response.status_code == 201
        assert Wallet.objects.get().currency == "EUR"

    def test_create_missing_fields(self, user_client):
        response = user_client.post(self.url, {}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"name"}

    def test_create_without_owners(self, user_client):
        response = user_client.post(self.url, {"name": "Cash", "owners": []}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"owners"}

    def test_create_unknown_owner(self, user_client):
        response = user_client.post(self.url, {"name": "Cash", "owners": [999]}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"owners"}

    @pytest.mark.parametrize("currency", ["EU", "EURO", "eur", "E1R"])
    def test_create_invalid_currency(self, user_client, user, currency):
        response = user_client.post(
            self.url, {"name": "Cash", "currency": currency, "owners": [user.pk]}, format="json"
        )

        assert response.status_code == 400
        assert set(response.json()) == {"currency"}
        assert not Wallet.objects.exists()

    def test_create_without_csrf_token(self, api_client, user):
        api_client.force_login(user)

        response = api_client.post(self.url, {"name": "Cash", "owners": [user.pk]}, format="json")

        assert response.status_code == 403


@pytest.mark.django_db
class TestWalletDetail:
    @staticmethod
    def url(wallet):
        return reverse("api:wallet", args=[wallet.pk])

    def test_retrieve(self, user_client, wallet):
        response = user_client.get(self.url(wallet))

        assert response.status_code == 200
        assert response.json()["name"] == "Bank"

    def test_retrieve_not_owned(self, user_client):
        # No per-object permissions: every user sees every wallet
        wallet = Wallet.objects.create(name="Cash")

        response = user_client.get(self.url(wallet))

        assert response.status_code == 200

    def test_update(self, user_client, user, wallet):
        other = User.objects.create_user("luca@example.com")

        response = user_client.patch(self.url(wallet), {"name": "Main bank", "owners": [other.pk]}, format="json")

        assert response.status_code == 200
        wallet.refresh_from_db()
        assert wallet.name == "Main bank"
        assert list(wallet.owners.all()) == [other]

    def test_update_currency_is_ignored(self, user_client, wallet):
        response = user_client.patch(self.url(wallet), {"currency": "USD"}, format="json")

        assert response.status_code == 200
        wallet.refresh_from_db()
        assert wallet.currency == "EUR"

    def test_update_without_owners(self, user_client, wallet):
        response = user_client.patch(self.url(wallet), {"owners": []}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"owners"}

    def test_update_to_joint_clears_the_owners(self, user_client, wallet):
        response = user_client.patch(self.url(wallet), {"is_shared": True}, format="json")

        assert response.status_code == 200
        assert not wallet.owners.exists()

    def test_update_joint_to_personal_needs_an_owner(self, user_client, user):
        joint = Wallet.objects.create(name="Joint", is_shared=True)

        response = user_client.patch(self.url(joint), {"is_shared": False}, format="json")
        assert response.status_code == 400
        assert response.json() == {"owners": ["A personal wallet has exactly one owner."]}

        response = user_client.patch(self.url(joint), {"is_shared": False, "owners": [user.pk]}, format="json")
        assert response.status_code == 200
        assert list(joint.owners.all()) == [user]

    def test_archive(self, user_client, wallet):
        response = user_client.patch(self.url(wallet), {"is_archived": True}, format="json")

        assert response.status_code == 200
        wallet.refresh_from_db()
        assert wallet.is_archived

    def test_delete_not_allowed(self, user_client, wallet):
        response = user_client.delete(self.url(wallet))

        assert response.status_code == 405
        assert Wallet.objects.filter(pk=wallet.pk).exists()

    def test_anonymous(self, api_client, wallet):
        response = api_client.get(self.url(wallet))

        assert response.status_code == 403


@pytest.mark.django_db
class TestWalletOwnerListView:
    url = reverse("api:wallet-owners")

    def test_list(self, user_client, user):
        admin = User.objects.create_superuser("admin@example.com", "secret-pass")

        response = user_client.get(self.url)

        assert response.status_code == 200
        assert response.json() == [
            {"id": admin.pk, "email": "admin@example.com", "first_name": "", "last_name": ""},
            {"id": user.pk, "email": "mario@example.com", "first_name": "Mario", "last_name": "Rossi"},
        ]

    def test_anonymous(self, api_client):
        response = api_client.get(self.url)

        assert response.status_code == 403
