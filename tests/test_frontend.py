import pytest
from django.test import Client


@pytest.fixture
def frontend_dir(tmp_path, settings):
    (tmp_path / "index.html").write_text("<!doctype html><title>Monely</title>")
    settings.FRONTEND_DIR = tmp_path
    return tmp_path


class TestFrontendView:
    @pytest.mark.parametrize("url", ["/", "/transactions/12", "/not/a/route", "/apis"])
    def test_index(self, frontend_dir, url):
        response = Client().get(url)

        assert response.status_code == 200
        assert response["Content-Type"] == "text/html; charset=utf-8"
        assert "no-cache" in response["Cache-Control"]
        assert b"".join(response.streaming_content) == b"<!doctype html><title>Monely</title>"

    def test_not_built(self, tmp_path, settings):
        settings.FRONTEND_DIR = tmp_path

        response = Client().get("/")

        assert response.status_code == 404

    @pytest.mark.parametrize("url", ["/api/missing/", "/static/missing.css"])
    def test_backend_routes(self, frontend_dir, url):
        response = Client().get(url)

        assert response.status_code == 404

    def test_admin_redirect(self, frontend_dir):
        response = Client().get("/admin")

        assert response.status_code == 301
        assert response["Location"] == "/admin/"
