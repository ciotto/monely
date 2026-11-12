from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import RegexValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils.translation import gettext_lazy as _


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError(_("The email must be set"))
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError(_("Superuser must have is_staff=True."))
        if extra_fields.get("is_superuser") is not True:
            raise ValueError(_("Superuser must have is_superuser=True."))

        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    username = None
    email = models.EmailField(_("email address"), unique=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        verbose_name = _("user")
        verbose_name_plural = _("users")

    def __str__(self):
        return self.email


class Wallet(models.Model):
    """A place where money lives (bank account, cash, credit card, ...); it is archived instead of deleted."""

    name = models.CharField(_("name"), max_length=100)
    currency = models.CharField(
        _("currency"),
        max_length=3,
        default="EUR",
        validators=[RegexValidator(r"^[A-Z]{3}\Z", _("Enter a three-letter ISO 4217 currency code, e.g. EUR."))],
    )
    owners = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="wallets", verbose_name=_("owners"))
    is_archived = models.BooleanField(_("archived"), default=False)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("wallet")
        verbose_name_plural = _("wallets")
        ordering = ("is_archived", "name")

    def __str__(self):
        return self.name


class Label(models.Model):
    """A name that classifies the transactions; it is unique regardless of the case."""

    name = models.CharField(_("name"), max_length=50)
    color = models.CharField(
        _("color"),
        max_length=7,
        default="#64748b",
        validators=[RegexValidator(r"^#[0-9a-fA-F]{6}\Z", _("Enter a hexadecimal color, e.g. #2563eb."))],
    )

    class Meta:
        abstract = True
        ordering = (Lower("name"),)
        constraints = [models.UniqueConstraint(Lower("name"), name="%(app_label)s_%(class)s_unique_name")]

    def __str__(self):
        return self.name


class Category(Label):
    """Classifies a transaction (e.g. groceries, rent, salary), for the reports and later the budgets."""

    # The kebab-case name of a Lucide icon (e.g. shopping-cart); the frontend offers a curated subset
    icon = models.CharField(
        _("icon"),
        max_length=50,
        blank=True,
        validators=[RegexValidator(r"^[a-z0-9]+(-[a-z0-9]+)*\Z", _("Enter the name of an icon, e.g. shopping-cart."))],
    )

    class Meta(Label.Meta):
        verbose_name = _("category")
        verbose_name_plural = _("categories")


class Tag(Label):
    """A free-form label attached to many transactions (e.g. holiday-2026), orthogonal to the categories."""

    class Meta(Label.Meta):
        verbose_name = _("tag")
        verbose_name_plural = _("tags")
