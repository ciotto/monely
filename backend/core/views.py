from django.conf import settings
from django.contrib.auth import login, logout, update_session_auth_hash
from django.db import connection, transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext_lazy as _
from django.views import View
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.generics import (
    CreateAPIView,
    GenericAPIView,
    ListAPIView,
    ListCreateAPIView,
    RetrieveUpdateAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.dashboard import build_dashboard
from core.models import Category, Tag, Transaction, Transfer, User, Wallet
from core.serializers import (
    TRANSFER_LEG_ERROR,
    AdminUserSerializer,
    CategorySerializer,
    DashboardFilterSerializer,
    LoginSerializer,
    OwnerSerializer,
    SetupSerializer,
    TagSerializer,
    TransactionFilterSerializer,
    TransactionImportSerializer,
    TransactionSerializer,
    TransferSerializer,
    UserSerializer,
    WalletSerializer,
)
from core.transactions_csv import TransactionImporter, write_transactions


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


class TransactionFilterMixin:
    """Filters the transactions with the query parameters of the list."""

    # Like in the dashboard, the transactions of a transfer are neither income nor expenses
    kinds = {
        "income": Q(transfer=None, amount__gt=0),
        "expense": Q(transfer=None, amount__lt=0),
        "transfer": Q(transfer__isnull=False),
    }

    def get_queryset(self):
        queryset = super().get_queryset()
        # Repeated parameters (e.g. ?tag=1&tag=2) are read as lists by the serializer
        filters = TransactionFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        if "wallet" in data:
            queryset = queryset.filter(wallet=data["wallet"])
        if "kind" in data:
            queryset = queryset.filter(self.kinds[data["kind"]])
        if data.get("category"):
            queryset = queryset.filter(category=data["category"])
        elif "category" in data:
            # The transactions of a transfer have no category either, but they are shown as transfers
            queryset = queryset.filter(category=None, transfer=None)
        if data.get("tag"):
            queryset = queryset.filter(tags__in=data["tag"]).distinct()
        if "date_from" in data:
            queryset = queryset.filter(date__gte=data["date_from"])
        if "date_to" in data:
            queryset = queryset.filter(date__lte=data["date_to"])
        return queryset


class TransactionPagination(LimitOffsetPagination):
    """Pages of the transaction list: the SPA loads the next one from the number of rows it already shows."""

    default_limit = 500
    max_limit = 500


class TransactionListView(TransactionFilterMixin, ListCreateAPIView):
    queryset = Transaction.objects.prefetch_related("tags")
    serializer_class = TransactionSerializer
    pagination_class = TransactionPagination


class TransactionExportView(TransactionFilterMixin, GenericAPIView):
    """Downloads the filtered transactions as CSV, oldest first, so an import keeps their order."""

    queryset = Transaction.objects.select_related("wallet", "category").prefetch_related("tags").order_by("date", "id")

    def get(self, request):
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="monely-transactions-{timezone.localdate()}.csv"'
        # The byte order mark makes spreadsheets read the file as UTF-8
        response.write("\ufeff")
        write_transactions(self.get_queryset(), response)
        return response


class TransactionImportView(APIView):
    """Uploads a CSV file in the export format, creating the missing wallets, categories and tags."""

    parser_classes = [MultiPartParser]

    def post(self, request):
        serializer = TransactionImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        created = TransactionImporter(request.user).run(serializer.validated_data["file"])
        return Response(created, status=status.HTTP_201_CREATED)


class TransactionDetailView(RetrieveUpdateDestroyAPIView):
    queryset = Transaction.objects.prefetch_related("tags")
    serializer_class = TransactionSerializer

    def perform_destroy(self, instance):
        if instance.transfer_id is not None:
            raise serializers.ValidationError(TRANSFER_LEG_ERROR)
        instance.delete()


class TransferCreateView(CreateAPIView):
    serializer_class = TransferSerializer


# Deleting a transfer also deletes its transactions
class TransferDetailView(RetrieveUpdateDestroyAPIView):
    queryset = Transfer.objects.prefetch_related("transactions__wallet")
    serializer_class = TransferSerializer


class DashboardView(APIView):
    def get(self, request):
        filters = DashboardFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        month = filters.validated_data.get("month", timezone.localdate()).replace(day=1)
        return Response(build_dashboard(month, filters.validated_data.get("wallet")))


class MaintenanceDataView(APIView):
    """Counts the data of the instance, or deletes it all; the users are kept, so the admins can still log in."""

    permission_classes = [IsAdminUser]
    # In deletion order: transactions protect their wallets
    models = {
        "transactions": Transaction,
        "transfers": Transfer,
        "wallets": Wallet,
        "categories": Category,
        "tags": Tag,
    }

    def count(self):
        return {name: model.objects.count() for name, model in self.models.items()}

    def get(self, request):
        return Response(self.count())

    def delete(self, request):
        with transaction.atomic():
            deleted = self.count()
            for model in self.models.values():
                model.objects.all().delete()
        return Response(deleted)


@method_decorator(never_cache, name="dispatch")
class FrontendView(View):
    """Serves the SPA entry point for every client-side route; unknown routes get the SPA's own 404 page."""

    def get(self, request, *args, **kwargs):
        index = settings.FRONTEND_DIR / "index.html"
        if not index.is_file():
            raise Http404
        return FileResponse(index.open("rb"), content_type="text/html; charset=utf-8")
