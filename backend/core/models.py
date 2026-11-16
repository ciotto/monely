import calendar
import datetime
from decimal import Decimal
from operator import attrgetter

from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils.functional import cached_property
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
    # A personal wallet has a single owner, a joint one belongs to the whole family and has none
    owners = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="wallets", verbose_name=_("owners")
    )
    is_archived = models.BooleanField(_("archived"), default=False)
    # A joint wallet, which receives the family contributions (see the family balance)
    is_shared = models.BooleanField(_("joint wallet"), default=False)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("wallet")
        verbose_name_plural = _("wallets")
        ordering = ("is_archived", "name")

    def __str__(self):
        return self.name


class ImportFormat(models.Model):
    """
    How to read the statements (CSV or xlsx) that the bank of a wallet exports: the columns are found by their header.

    The amount is either a signed column, or the difference between an income and an expense column.
    """

    class DateFormat(models.TextChoices):
        DAY_MONTH_YEAR = "%d/%m/%Y", "31/12/2026"
        DAY_MONTH_SHORT_YEAR = "%d/%m/%y", "31/12/26"
        DAY_MONTH_YEAR_DASH = "%d-%m-%Y", "31-12-2026"
        DAY_MONTH_YEAR_DOT = "%d.%m.%Y", "31.12.2026"
        ISO = "%Y-%m-%d", "2026-12-31"
        MONTH_DAY_YEAR = "%m/%d/%Y", "12/31/2026"

    class DecimalSeparator(models.TextChoices):
        COMMA = ",", _("comma (1.234,56)")
        DOT = ".", _("dot (1,234.56)")

    class Delimiter(models.TextChoices):
        SEMICOLON = ";", _("semicolon")
        COMMA = ",", _("comma")
        TAB = "\t", _("tab")

    wallet = models.OneToOneField(
        Wallet, on_delete=models.CASCADE, primary_key=True, related_name="import_format", verbose_name=_("wallet")
    )
    date_column = models.CharField(_("date column"), max_length=100)
    # Only for the dates written as text: spreadsheets usually store real dates
    date_format = models.CharField(
        _("date format"), max_length=20, choices=DateFormat, default=DateFormat.DAY_MONTH_YEAR
    )
    amount_column = models.CharField(_("amount column"), max_length=100, blank=True)
    income_column = models.CharField(_("income column"), max_length=100, blank=True)
    expense_column = models.CharField(_("expense column"), max_length=100, blank=True)
    description_column = models.CharField(_("description column"), max_length=100, blank=True)
    # Only for the amounts written as text, like the dates
    decimal_separator = models.CharField(
        _("decimal separator"), max_length=1, choices=DecimalSeparator, default=DecimalSeparator.COMMA
    )
    # Only for the CSV files
    delimiter = models.CharField(_("CSV delimiter"), max_length=1, choices=Delimiter, default=Delimiter.SEMICOLON)
    # e.g. the credit cards that list the expenses as positive amounts
    negate_amounts = models.BooleanField(_("invert the sign of the amounts"), default=False)

    class Meta:
        verbose_name = _("import format")
        verbose_name_plural = _("import formats")

    def __str__(self):
        return str(self.wallet)


class BankMovement(models.Model):
    """
    A movement read from a bank statement. It is not a transaction: it is reconciled with the transactions of its
    wallet, to find the ones that were not entered.

    Banks can change the other fields over time, so a movement is identified only by its date and amount.
    """

    wallet = models.ForeignKey(
        Wallet, on_delete=models.CASCADE, related_name="bank_movements", verbose_name=_("wallet")
    )
    date = models.DateField(_("date"))
    amount = models.DecimalField(_("amount"), max_digits=12, decimal_places=2)
    # As written by the bank when it was imported
    description = models.CharField(_("description"), max_length=200, blank=True)
    # Not to be entered (e.g. a payment and its cancellation), so it is not reconciled
    is_ignored = models.BooleanField(_("ignored"), default=False)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("bank movement")
        verbose_name_plural = _("bank movements")
        ordering = ("-date", "-id")

    def __str__(self):
        return f"{self.date} {self.description} {self.amount}"


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
    """Classifies a transaction (e.g. groceries, rent, salary), for the reports and the budgets."""

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


class Budget(models.Model):
    """The amount that a category can spend every month, in one currency: amounts are never converted."""

    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="budgets", verbose_name=_("category"))
    currency = models.CharField(
        _("currency"),
        max_length=3,
        default="EUR",
        validators=[RegexValidator(r"^[A-Z]{3}\Z", _("Enter a three-letter ISO 4217 currency code, e.g. EUR."))],
    )
    # The monthly limit of the expenses, so it is positive
    amount = models.DecimalField(
        _("amount"), max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))]
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("budget")
        verbose_name_plural = _("budgets")
        ordering = ("currency", Lower("category__name"))
        constraints = [
            models.UniqueConstraint(fields=("category", "currency"), name="core_budget_unique_category_currency")
        ]

    def __str__(self):
        return f"{self.category} {self.amount} {self.currency}"


class Contribution(models.Model):
    """
    What the family has to transfer to the joint wallets every month, in total, in one currency: every user contributes
    an equal share of it, from the first month on.
    """

    currency = models.CharField(
        _("currency"),
        max_length=3,
        unique=True,
        default="EUR",
        validators=[RegexValidator(r"^[A-Z]{3}\Z", _("Enter a three-letter ISO 4217 currency code, e.g. EUR."))],
    )
    amount = models.DecimalField(
        _("amount"), max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))]
    )
    # Always the first day of the month
    start_month = models.DateField(_("first month"))
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("family contribution")
        verbose_name_plural = _("family contributions")
        ordering = ("currency",)

    def __str__(self):
        return f"{self.amount} {self.currency}"


class Tag(Label):
    """A free-form label attached to many transactions (e.g. holiday-2026), orthogonal to the categories."""

    class Meta(Label.Meta):
        verbose_name = _("tag")
        verbose_name_plural = _("tags")


class Transfer(models.Model):
    """
    Moves money between two wallets with the same currency, through an outgoing and an incoming transaction.

    The two transactions share date, description and notes; they are not incomes or expenses, so they have no category
    and the reports ignore them, while the balances include them.
    """

    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("transfer")
        verbose_name_plural = _("transfers")

    def __str__(self):
        return str(self.pk)

    @cached_property
    def legs(self):
        """The outgoing and the incoming transaction."""
        return sorted(self.transactions.all(), key=attrgetter("amount"))


class Transaction(models.Model):
    """A single money movement on a wallet: negative amounts are expenses, positive ones are incomes."""

    # Wallets are archived instead of deleted, so their transactions are never lost
    wallet = models.ForeignKey(Wallet, on_delete=models.PROTECT, related_name="transactions", verbose_name=_("wallet"))
    date = models.DateField(_("date"))
    amount = models.DecimalField(_("amount"), max_digits=12, decimal_places=2)
    description = models.CharField(_("description"), max_length=200)
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
        verbose_name=_("category"),
    )
    tags = models.ManyToManyField(Tag, blank=True, related_name="transactions", verbose_name=_("tags"))
    notes = models.TextField(_("notes"), blank=True)
    # A shared expense paid from a personal wallet counts as a contribution to the joint wallets (never on transfers)
    is_shared = models.BooleanField(_("shared expense"), default=False)
    # Set on the two transactions of a transfer, which are edited and deleted together
    transfer = models.ForeignKey(
        Transfer,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="transactions",
        verbose_name=_("transfer"),
    )
    # Set when the transaction registers an occurrence of a recurring transaction
    recurring_transaction = models.ForeignKey(
        "RecurringTransaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
        verbose_name=_("recurring transaction"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("transaction")
        verbose_name_plural = _("transactions")
        ordering = ("-date", "-id")

    def __str__(self):
        return f"{self.date} {self.description} {self.amount}"


def add_months(day, months):
    """Moves a date by whole months; the day is clamped to the end of the shorter months (e.g. Jan 31 -> Feb 28)."""
    year, month = divmod(day.year * 12 + day.month - 1 + months, 12)
    month += 1
    return day.replace(year=year, month=month, day=min(day.day, calendar.monthrange(year, month)[1]))


class RecurringTransaction(models.Model):
    """
    A transaction that repeats on a schedule (e.g. rent, salary, subscriptions).

    It is not a real transaction, so the balances and the reports ignore it: its occurrences are suggested around their
    due date, and each one is either registered as a transaction or skipped, which moves on to the following one.
    """

    class Frequency(models.TextChoices):
        WEEKLY = "weekly", _("weekly")
        MONTHLY = "monthly", _("monthly")
        YEARLY = "yearly", _("yearly")

    # Wallets are archived instead of deleted, like for the transactions
    wallet = models.ForeignKey(
        Wallet, on_delete=models.PROTECT, related_name="recurring_transactions", verbose_name=_("wallet")
    )
    amount = models.DecimalField(_("amount"), max_digits=12, decimal_places=2)
    description = models.CharField(_("description"), max_length=200)
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recurring_transactions",
        verbose_name=_("category"),
    )
    tags = models.ManyToManyField(Tag, blank=True, related_name="recurring_transactions", verbose_name=_("tags"))
    notes = models.TextField(_("notes"), blank=True)
    # Copied to the transactions that register its occurrences
    is_shared = models.BooleanField(_("shared expense"), default=False)
    frequency = models.CharField(_("frequency"), max_length=10, choices=Frequency, default=Frequency.MONTHLY)
    # Repeats every `interval` weeks, months or years, e.g. 3 months for a quarterly bill
    interval = models.PositiveSmallIntegerField(_("interval"), default=1, validators=[MinValueValidator(1)])
    # The first occurrence, which anchors the others: a monthly one on the 31st falls on the last day of shorter months
    start_date = models.DateField(_("start date"))
    end_date = models.DateField(_("end date"), null=True, blank=True)
    # The occurrences before this one have already been registered or skipped
    next_date = models.DateField(_("next date"))
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("recurring transaction")
        verbose_name_plural = _("recurring transactions")
        ordering = ("next_date", "id")

    def __str__(self):
        return f"{self.description} {self.amount}"

    @property
    def is_ended(self):
        return self.end_date is not None and self.next_date > self.end_date

    @property
    def monthly_amount(self):
        """The cost of a month, spreading each occurrence over the months until the following one (rounded to cents)."""
        if self.frequency == self.Frequency.WEEKLY:
            value = self.amount * 52 / (12 * self.interval)
        else:
            value = self.amount / (self.interval * (12 if self.frequency == self.Frequency.YEARLY else 1))
        return value.quantize(Decimal("0.01"))

    def occurrence(self, index):
        """The date of the occurrence `index`, starting from 0."""
        if self.frequency == self.Frequency.WEEKLY:
            return self.start_date + datetime.timedelta(weeks=index * self.interval)
        months = index * self.interval * (12 if self.frequency == self.Frequency.YEARLY else 1)
        return add_months(self.start_date, months)

    def occurrence_after(self, date):
        """The first occurrence after `date`."""
        index = 0
        while self.occurrence(index) <= date:
            index += 1
        return self.occurrence(index)

    def reschedule(self):
        """After a change of the schedule, the next occurrence is the first one not before the current next date."""
        self.next_date = self.occurrence_after(self.next_date - datetime.timedelta(days=1))

    def advance(self):
        """Moves on to the following occurrence, once the next one has been registered or skipped."""
        self.next_date = self.occurrence_after(self.next_date)
        self.save(update_fields=["next_date"])
