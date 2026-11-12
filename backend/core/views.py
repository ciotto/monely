from django.contrib.auth import login, logout, update_session_auth_hash
from django.db import connection, transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext_lazy as _
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveUpdateAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.dashboard import build_dashboard
from core.models import Category, Tag, Transaction, User, Wallet
from core.serializers import (
    AdminUserSerializer,
    CategorySerializer,
    DashboardFilterSerializer,
    LoginSerializer,
    OwnerSerializer,
    SetupSerializer,
    TagSerializer,
    TransactionFilterSerializer,
    TransactionSerializer,
    UserSerializer,
    WalletSerializer,
)


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


class UserListView(ListCreateAPIView):
    permission_classes = [IsAdminUser]
    queryset = User.objects.order_by("email")
    serializer_class = AdminUserSerializer


class UserDetailView(RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdminUser]
    queryset = User.objects.all()
    serializer_class = AdminUserSerializer

    def perform_update(self, serializer):
        user = serializer.save()
        # Changing the own password would otherwise end the current session
        if user == self.request.user:
            update_session_auth_hash(self.request, user)

    def perform_destroy(self, instance):
        if instance == self.request.user:
            raise PermissionDenied(_("You cannot delete your own account."))
        instance.delete()


class WalletListView(ListCreateAPIView):
    queryset = Wallet.objects.prefetch_related("owners")
    serializer_class = WalletSerializer


# Wallets are archived instead of deleted
class WalletDetailView(RetrieveUpdateAPIView):
    queryset = Wallet.objects.prefetch_related("owners")
    serializer_class = WalletSerializer


class WalletOwnerListView(ListAPIView):
    """The users that can be chosen as wallet owners; the user management is reserved to the admins."""

    queryset = User.objects.order_by("email")
    serializer_class = OwnerSerializer


class CategoryListView(ListCreateAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer


class CategoryDetailView(RetrieveUpdateDestroyAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer


class TagListView(ListCreateAPIView):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer


class TagDetailView(RetrieveUpdateDestroyAPIView):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer


class TransactionListView(ListCreateAPIView):
    queryset = Transaction.objects.prefetch_related("tags")
    serializer_class = TransactionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        # Repeated parameters (e.g. ?tag=1&tag=2) are read as lists by the serializer
        filters = TransactionFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        if "wallet" in data:
            queryset = queryset.filter(wallet=data["wallet"])
        if "category" in data:
            queryset = queryset.filter(category=data["category"])
        if data.get("tag"):
            queryset = queryset.filter(tags__in=data["tag"]).distinct()
        if "date_from" in data:
            queryset = queryset.filter(date__gte=data["date_from"])
        if "date_to" in data:
            queryset = queryset.filter(date__lte=data["date_to"])
        return queryset


class TransactionDetailView(RetrieveUpdateDestroyAPIView):
    queryset = Transaction.objects.prefetch_related("tags")
    serializer_class = TransactionSerializer


class DashboardView(APIView):
    def get(self, request):
        filters = DashboardFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        month = filters.validated_data.get("month", timezone.localdate()).replace(day=1)
        return Response(build_dashboard(month, filters.validated_data.get("wallet")))
