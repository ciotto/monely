import pytest
from django.urls import reverse

from core.models import Category, Tag

# Categories and tags share the same API: (list url name, detail url name, model)
RESOURCES = [("api:categories", "api:category", Category), ("api:tags", "api:tag", Tag)]
FIELDS = {Category: {"id", "name", "color", "icon"}, Tag: {"id", "name", "color"}}


@pytest.fixture
def user_client(api_client, user):
    api_client.force_login(user)
    # Write requests from an authenticated session need the CSRF token
    api_client.credentials(HTTP_X_CSRFTOKEN=api_client.get(reverse("api:me")).cookies["csrftoken"].value)
    return api_client


@pytest.mark.django_db
@pytest.mark.parametrize("list_url,detail_url,model", RESOURCES)
class TestLabelApi:
    def test_list(self, user_client, list_url, detail_url, model):
        for name in ["rent", "Groceries", "salary"]:
            model.objects.create(name=name)

        response = user_client.get(reverse(list_url))

        assert response.status_code == 200
        assert [item["name"] for item in response.json()] == ["Groceries", "rent", "salary"]
        assert set(response.json()[0]) == FIELDS[model]

    def test_list_anonymous(self, api_client, list_url, detail_url, model):
        response = api_client.get(reverse(list_url))

        assert response.status_code == 403

    def test_create(self, user_client, list_url, detail_url, model):
        response = user_client.post(reverse(list_url), {"name": " Groceries ", "color": "#16A34A"}, format="json")

        assert response.status_code == 201
        item = model.objects.get()
        assert response.json()["id"] == item.pk
        assert item.name == "Groceries"
        assert item.color == "#16A34A"

    def test_create_default_color(self, user_client, list_url, detail_url, model):
        response = user_client.post(reverse(list_url), {"name": "Groceries"}, format="json")

        assert response.status_code == 201
        assert model.objects.get().color == "#64748b"

    @pytest.mark.parametrize("color", ["16a34a", "#16a34", "#16a34a0", "#16g34a", "green"])
    def test_create_invalid_color(self, user_client, list_url, detail_url, model, color):
        response = user_client.post(reverse(list_url), {"name": "Groceries", "color": color}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"color"}

    def test_create_missing_name(self, user_client, list_url, detail_url, model):
        response = user_client.post(reverse(list_url), {"name": ""}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"name"}

    def test_create_duplicate_name(self, user_client, list_url, detail_url, model):
        model.objects.create(name="Groceries")

        response = user_client.post(reverse(list_url), {"name": "GROCERIES"}, format="json")

        assert response.status_code == 400
        assert response.json() == {"name": ["This name is already in use."]}
        assert model.objects.count() == 1

    def test_rename(self, user_client, list_url, detail_url, model):
        item = model.objects.create(name="Groceries")

        response = user_client.patch(
            reverse(detail_url, args=[item.pk]), {"name": "Food", "color": "#dc2626"}, format="json"
        )

        assert response.status_code == 200
        item.refresh_from_db()
        assert item.name == "Food"
        assert item.color == "#dc2626"

    def test_rename_changing_the_case(self, user_client, list_url, detail_url, model):
        item = model.objects.create(name="groceries")

        response = user_client.put(reverse(detail_url, args=[item.pk]), {"name": "Groceries"}, format="json")

        assert response.status_code == 200
        item.refresh_from_db()
        assert item.name == "Groceries"

    def test_rename_duplicate_name(self, user_client, list_url, detail_url, model):
        model.objects.create(name="Food")
        item = model.objects.create(name="Groceries")

        response = user_client.patch(reverse(detail_url, args=[item.pk]), {"name": "food"}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"name"}

    def test_delete(self, user_client, list_url, detail_url, model):
        item = model.objects.create(name="Groceries")

        response = user_client.delete(reverse(detail_url, args=[item.pk]))

        assert response.status_code == 204
        assert not model.objects.exists()


@pytest.mark.django_db
class TestCategoryIcon:
    def test_create(self, user_client):
        response = user_client.post(
            reverse("api:categories"), {"name": "Groceries", "icon": "shopping-cart"}, format="json"
        )

        assert response.status_code == 201
        assert response.json()["icon"] == "shopping-cart"
        assert Category.objects.get().icon == "shopping-cart"

    def test_create_without_icon(self, user_client):
        response = user_client.post(reverse("api:categories"), {"name": "Rent"}, format="json")

        assert response.status_code == 201
        assert Category.objects.get().icon == ""

    @pytest.mark.parametrize("icon", ["🏠", "ShoppingCart", "shopping cart", "-house", "house-", "a" * 51])
    def test_invalid_icon(self, user_client, icon):
        response = user_client.post(reverse("api:categories"), {"name": "Rent", "icon": icon}, format="json")

        assert response.status_code == 400
        assert set(response.json()) == {"icon"}

    def test_update(self, user_client):
        category = Category.objects.create(name="Groceries")

        response = user_client.patch(reverse("api:category", args=[category.pk]), {"icon": "gamepad-2"}, format="json")

        assert response.status_code == 200
        category.refresh_from_db()
        assert category.icon == "gamepad-2"

    def test_tags_have_no_icon(self, user_client):
        response = user_client.post(reverse("api:tags"), {"name": "car", "icon": "car"}, format="json")

        assert response.status_code == 201
        assert "icon" not in response.json()
        assert not hasattr(Tag.objects.get(), "icon")
