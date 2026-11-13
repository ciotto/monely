import csv
import io

from django.db import transaction
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from core.models import Category, Tag, Transaction, Transfer, Wallet

# The columns are not translated, so a file can be imported whatever the language of who exported it
# The two transactions of a transfer share a value of the `transfer` column, only meaningful within the file
COLUMNS = ("date", "wallet", "currency", "amount", "description", "category", "tags", "notes", "transfer")
REQUIRED_COLUMNS = ("date", "wallet", "amount", "description")
# Joins the names of the tags in a single cell
TAG_SEPARATOR = "|"


def write_transactions(transactions, file):
    """Writes the transactions as CSV, with wallet, category and tags by name."""
    writer = csv.writer(file)
    writer.writerow(COLUMNS)
    for item in transactions:
        writer.writerow(
            (
                item.date.isoformat(),
                item.wallet.name,
                item.wallet.currency,
                item.amount,
                item.description,
                item.category.name if item.category else "",
                TAG_SEPARATOR.join(tag.name for tag in item.tags.all()),
                item.notes,
                item.transfer_id or "",
            )
        )


class TransactionRowSerializer(serializers.Serializer):
    """A CSV row; wallet, category and tags are names, matched regardless of the case."""

    date = serializers.DateField()
    wallet = serializers.CharField(max_length=Wallet._meta.get_field("name").max_length)
    currency = serializers.RegexField(r"^[A-Z]{3}\Z", required=False, allow_blank=True)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    description = serializers.CharField(max_length=Transaction._meta.get_field("description").max_length)
    category = serializers.CharField(
        max_length=Category._meta.get_field("name").max_length, required=False, allow_blank=True
    )
    tags = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    transfer = serializers.CharField(max_length=50, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs.get("transfer") and (attrs.get("category") or attrs.get("tags")):
            raise serializers.ValidationError({"transfer": [_("A transfer has no category and no tags.")]})
        return attrs

    def validate_amount(self, value):
        if value == 0:
            raise serializers.ValidationError(_("The amount cannot be zero."))
        return value

    def validate_tags(self, value):
        names = [name.strip() for name in value.split(TAG_SEPARATOR) if name.strip()]
        max_length = Tag._meta.get_field("name").max_length
        if any(len(name) > max_length for name in names):
            raise serializers.ValidationError(
                _("Ensure every tag has no more than %(max_length)d characters.") % {"max_length": max_length}
            )
        return names


class TransactionImporter:
    """Creates the transactions of a CSV file, with the missing wallets, categories and tags; all or nothing."""

    def __init__(self, user):
        self.user = user
        # The objects matched or created so far, by lowercase name
        self.wallets = {}
        self.categories = {}
        self.tags = {}
        # The row numbers and the transactions of each transfer, by the value of the `transfer` column
        self.transfers = {}
        self.created = {"transactions": 0, "wallets": 0, "categories": 0, "tags": 0}

    def run(self, file):
        rows = self.read(file)
        errors = []
        with transaction.atomic():
            # The header is the first row
            for number, row in enumerate(rows, start=2):
                serializer = TransactionRowSerializer(data={key: value for key, value in row.items() if value})
                if not serializer.is_valid():
                    errors.extend(self.format_errors(number, serializer.errors))
                    continue
                try:
                    self.create(serializer.validated_data, number)
                except serializers.ValidationError as e:
                    errors.extend(self.format_errors(number, e.detail))
            # A transfer is checked once all its rows are valid
            if not errors:
                errors = self.create_transfers()
            if errors:
                # Rolls back what has been created so far
                raise serializers.ValidationError({"file": errors})
        return self.created

    def read(self, file):
        try:
            # Spreadsheets often add the byte order mark to UTF-8 files
            text = file.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            raise serializers.ValidationError({"file": [_("The file must be a CSV encoded in UTF-8.")]})
        reader = csv.DictReader(io.StringIO(text, newline=""))
        missing = [column for column in REQUIRED_COLUMNS if column not in (reader.fieldnames or ())]
        if missing:
            raise serializers.ValidationError(
                {"file": [_("Missing columns: %(columns)s.") % {"columns": ", ".join(missing)}]}
            )
        rows = list(reader)
        if not rows:
            raise serializers.ValidationError({"file": [_("The file contains no transactions.")]})
        return rows

    @staticmethod
    def format_errors(number, errors):
        return [
            _("Row %(number)d, %(field)s: %(message)s") % {"number": number, "field": field, "message": message}
            for field, messages in errors.items()
            for message in messages
        ]

    def create(self, data, number):
        wallet = self.get_wallet(data["wallet"], data.get("currency"))
        category = self.get_label(Category, "categories", data["category"]) if data.get("category") else None
        item = Transaction.objects.create(
            wallet=wallet,
            date=data["date"],
            amount=data["amount"],
            description=data["description"],
            category=category,
            notes=data.get("notes", ""),
        )
        item.tags.set([self.get_label(Tag, "tags", name) for name in data.get("tags", [])])
        self.created["transactions"] += 1
        if data.get("transfer"):
            self.transfers.setdefault(data["transfer"], []).append((number, item))

    def create_transfers(self):
        errors = []
        for rows in self.transfers.values():
            # The errors refer to the first row of the transfer
            number = rows[0][0]
            legs = sorted((item for _number, item in rows), key=lambda item: item.amount)
            if len(legs) != 2:
                message = _("A transfer needs exactly two rows.")
            elif (
                legs[0].amount != -legs[1].amount
                or legs[0].date != legs[1].date
                or legs[0].wallet == legs[1].wallet
                or legs[0].wallet.currency != legs[1].wallet.currency
            ):
                message = _(
                    "The rows of a transfer need opposite amounts, the same date and different wallets with the same "
                    "currency."
                )
            else:
                transfer = Transfer.objects.create()
                Transaction.objects.filter(pk__in=[leg.pk for leg in legs]).update(transfer=transfer)
                continue
            errors.extend(self.format_errors(number, {"transfer": [message]}))
        return errors

    def get_wallet(self, name, currency):
        key = name.lower()
        if key not in self.wallets:
            # Wallet names are not unique, so more than one can match
            matches = list(Wallet.objects.filter(name__iexact=name)[:2])
            if not matches:
                wallet = Wallet.objects.create(
                    name=name, currency=currency or Wallet._meta.get_field("currency").default
                )
                wallet.owners.add(self.user)
                self.created["wallets"] += 1
                matches = [wallet]
            self.wallets[key] = matches
        matches = self.wallets[key]
        if len(matches) > 1:
            raise serializers.ValidationError({"wallet": [_("More than one wallet has this name.")]})
        wallet = matches[0]
        # Archived wallets keep their transactions, but do not receive new ones
        if wallet.is_archived:
            raise serializers.ValidationError({"wallet": [_("This wallet is archived.")]})
        if currency and currency != wallet.currency:
            raise serializers.ValidationError(
                {"currency": [_("The wallet uses %(currency)s.") % {"currency": wallet.currency}]}
            )
        return wallet

    def get_label(self, model, kind, name):
        """Returns the category or tag (`kind` is the plural) with this name, creating it with the default color."""
        cache = getattr(self, kind)
        key = name.lower()
        if key not in cache:
            cache[key] = model.objects.filter(name__iexact=name).first()
            if cache[key] is None:
                cache[key] = model.objects.create(name=name)
                self.created[kind] += 1
        return cache[key]
