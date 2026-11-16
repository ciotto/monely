from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.translation import gettext_lazy as _

from core.models import Budget, Category, Contribution, RecurringTransaction, Tag, Transaction, Transfer, User, Wallet


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (_("Personal info"), {"fields": ("first_name", "last_name")}),
        (
            _("Permissions"),
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)
    list_display = ("email", "first_name", "last_name", "is_staff")
    search_fields = ("email", "first_name", "last_name")
    ordering = ("email",)


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ("name", "currency", "is_shared", "is_archived")
    list_filter = ("is_shared", "is_archived", "currency")
    search_fields = ("name",)
    filter_horizontal = ("owners",)


@admin.register(Tag)
class LabelAdmin(admin.ModelAdmin):
    list_display = ("name", "color")
    search_fields = ("name",)


@admin.register(Category)
class CategoryAdmin(LabelAdmin):
    list_display = ("icon", "name", "color")


@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
    list_display = ("category", "amount", "currency")
    list_filter = ("currency",)
    list_select_related = ("category",)


@admin.register(Contribution)
class ContributionAdmin(admin.ModelAdmin):
    list_display = ("currency", "amount", "start_month")


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "description", "amount", "wallet", "category", "is_shared", "transfer")
    list_filter = ("is_shared", "wallet", "category", "tags")
    # The transactions of a transfer, and the occurrences of a recurring transaction, are kept consistent by the API
    readonly_fields = ("transfer", "recurring_transaction")
    search_fields = ("description", "notes")
    date_hierarchy = "date"
    filter_horizontal = ("tags",)
    list_select_related = ("wallet", "category")


class ReadOnlyTransactionInline(admin.TabularInline):
    model = Transaction
    fields = ("date", "wallet", "amount", "description")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj):
        return False


@admin.register(Transfer)
class TransferAdmin(admin.ModelAdmin):
    list_display = ("id", "created_at")
    inlines = (ReadOnlyTransactionInline,)


@admin.register(RecurringTransaction)
class RecurringTransactionAdmin(admin.ModelAdmin):
    list_display = ("description", "amount", "wallet", "category", "frequency", "interval", "next_date", "end_date")
    list_filter = ("frequency", "wallet", "category", "tags")
    search_fields = ("description", "notes")
    filter_horizontal = ("tags",)
    list_select_related = ("wallet", "category")
    # The transactions that registered its occurrences
    inlines = (ReadOnlyTransactionInline,)
