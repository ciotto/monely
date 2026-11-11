from django.contrib.auth import login, logout
from django.db import connection, transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.models import User
from core.serializers import LoginSerializer, SetupSerializer, UserSerializer


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        login(request, user)
        return Response(UserSerializer(user).data)


class SetupView(APIView):
    """Creates the first user; the endpoint does not exist anymore once any user has been created."""

    permission_classes = [AllowAny]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if User.objects.exists():
            raise NotFound

    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)

    def post(self, request):
        serializer = SetupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            # Serializes concurrent setups: only the first one can see an empty table
            with connection.cursor() as cursor:
                cursor.execute(f"LOCK TABLE {User._meta.db_table} IN SHARE ROW EXCLUSIVE MODE")  # nosec B608
            if User.objects.exists():
                raise NotFound
            user = serializer.save()
        login(request, user)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# The SPA calls this on startup, so it also sets the CSRF cookie for anonymous users
@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)
