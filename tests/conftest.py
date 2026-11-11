import pytest
from rest_framework.test import APIClient

from core.models import User


@pytest.fixture
def api_client():
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def user():
    return User.objects.create_user("mario@example.com", "secret-pass", first_name="Mario", last_name="Rossi")
