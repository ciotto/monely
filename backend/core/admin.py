from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.translation import gettext_lazy as _

from core.models import Category, Tag, Transaction, Transfer, User, Wallet


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
    list_display = ("name", "currency", "is_archived")
    list_filter = ("is_archived", "currency")
    search_fields = ("name",)
    filter_horizontal = ("owners",)


@admin.register(Tag)
class LabelAdmin(admin.ModelAdmin):
    list_display = ("name", "color")
    search_fields = ("name",)


@admin.register(Category)
class CategoryAdmin(LabelAdmin):
    list_display = ("icon", "name", "color")


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "description", "amount", "wallet", "category", "transfer")
    list_filter = ("wallet", "category", "tags")
    # The transactions of a transfer are created and kept consistent by the API
    readonly_fields = ("transfer",)
    search_fields = ("description", "notes")
    date_hierarchy = "date"
    filter_horizontal = ("tags",)
    list_select_related = ("wallet", "category")


class TransferTransactionInline(admin.TabularInline):
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
    inlines = (TransferTransactionInline,)
