import csv
import datetime
import io
import re
import zipfile
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import transaction
from django.utils.translation import gettext_lazy as _
from openpyxl import load_workbook
from rest_framework import serializers

from core.models import BankMovement, Wallet

# The banks that do not use UTF-8 usually export in the Windows encoding of western Europe
CSV_ENCODINGS = ("utf-8-sig", "cp1252")
CENT = Decimal("0.01")
# The amounts are stored with 12 digits, 2 of them decimal
MAX_AMOUNT = Decimal("1e10")
DESCRIPTION_LENGTH = BankMovement._meta.get_field("description").max_length


def cell_text(value):
    """The text of a cell, on a single line."""
    return " ".join(str(value).split()) if value is not None else ""


class StatementImporter:
    """
    Imports the movements of a bank statement (CSV or xlsx) of a wallet, read with its import format; all or nothing.

    Statements overlap and banks change the other fields over time, so the movements are compared only by date and
    amount: for each pair, the file adds the movements beyond the ones already imported (e.g. a third coffee of the same
    price on the same day).
    """

    def __init__(self, wallet):
        self.wallet = wallet
        self.format = wallet.import_format
        # The header of each field, matched regardless of the case
        self.columns = {
            field: getattr(self.format, f"{field}_column")
            for field in ("date", "amount", "income", "expense", "description")
            if getattr(self.format, f"{field}_column")
        }

    def run(self, file):
        movements = self.parse(self.read(file))
        with transaction.atomic():
            # Serializes the imports of the wallet, which could otherwise add the same movements twice
            Wallet.objects.select_for_update().get(pk=self.wallet.pk)
            created = self.create(movements)
        return {"imported": len(created), "duplicates": len(movements) - len(created)}

    def read(self, file):
        """The rows of the file, as lists of cells; the xlsx files are zip archives."""
        content = file.read()
        if zipfile.is_zipfile(io.BytesIO(content)):
            return self.read_xlsx(content)
        for encoding in CSV_ENCODINGS:
            try:
                text = content.decode(encoding)
            except UnicodeDecodeError:
                continue
            return list(csv.reader(io.StringIO(text, newline=""), delimiter=self.format.delimiter))
        raise serializers.ValidationError({"file": [_("The file must be a CSV or an xlsx file.")]})

    @staticmethod
    def read_xlsx(content):
        try:
            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        # openpyxl raises many kinds of errors on the archives that are not workbooks
        except Exception:
            raise serializers.ValidationError({"file": [_("The file must be a CSV or an xlsx file.")]})
        try:
            # The statement is in the first sheet
            return [list(row) for row in workbook.worksheets[0].iter_rows(values_only=True)]
        finally:
            workbook.close()

    def parse(self, rows):
        """The movements of the rows below the header; the ones without a date are other text of the bank."""
        start, positions = self.find_header(rows)
        movements = []
        errors = []
        for number, row in enumerate(rows[start:], start=start + 1):
            cells = {field: row[index] if index < len(row) else None for field, index in positions.items()}
            date = self.parse_date(cells["date"])
            if date is None:
                continue
            try:
                amount = self.parse_amount(cells)
            except InvalidOperation:
                errors.append(_("Row %(number)d: the amount is not valid.") % {"number": number})
                continue
            # e.g. the movements still to be booked by some banks
            if not amount:
                continue
            movements.append(
                BankMovement(
                    wallet=self.wallet,
                    date=date,
                    amount=amount,
                    description=cell_text(cells.get("description"))[:DESCRIPTION_LENGTH],
                )
            )
        if errors:
            raise serializers.ValidationError({"file": errors})
        if not movements:
            raise serializers.ValidationError(
                {"file": [_("The file contains no movements: check the import format of the wallet.")]}
            )
        return movements

    def find_header(self, rows):
        """The index of the first row after the header, which can follow other text, and the index of each column."""
        names = {field: name.strip().casefold() for field, name in self.columns.items()}
        for index, row in enumerate(rows):
            headers = [cell_text(cell).casefold() for cell in row]
            if all(name in headers for name in names.values()):
                return index + 1, {field: headers.index(name) for field, name in names.items()}
        raise serializers.ValidationError(
            {
                "file": [
                    _("No row of the file has the columns: %(columns)s.")
                    % {"columns": ", ".join(self.columns.values())}
                ]
            }
        )

    def parse_date(self, value):
        """The date of a cell, or None if it is not a date (e.g. a total); the text ones can be followed by a time."""
        # openpyxl reads all the dates as datetimes
        if isinstance(value, datetime.datetime):
            return value.date()
        words = value.split() if isinstance(value, str) else []
        try:
            return datetime.datetime.strptime(words[0], self.format.date_format).date() if words else None
        except ValueError:
            return None

    def parse_amount(self, cells):
        """The signed amount of the row, None if empty; raises InvalidOperation if it is not valid."""
        if "amount" in self.columns:
            amount = self.parse_number(cells["amount"])
        else:
            income = self.parse_number(cells["income"])
            expense = self.parse_number(cells["expense"])
            # The expenses can be written with or without their sign
            amount = None if income is None and expense is None else abs(income or 0) - abs(expense or 0)
        if amount is None:
            return None
        if abs(amount) >= MAX_AMOUNT:
            raise InvalidOperation
        amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)
        return -amount if self.format.negate_amounts else amount

    def parse_number(self, value):
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return Decimal(str(value))
        text = str(value).strip()
        if not text:
            return None
        # Drops the currency symbols and the spaces, then the thousands separators
        text = re.sub(r"[^\d,.+-]", "", text)
        thousands = "." if self.format.decimal_separator == "," else ","
        text = text.replace(thousands, "").replace(self.format.decimal_separator, ".")
        # Some banks write the sign after the number
        if text.endswith("-"):
            text = "-" + text[:-1]
        return Decimal(text)

    def create(self, movements):
        dates = [movement.date for movement in movements]
        stored = Counter(
            BankMovement.objects.filter(wallet=self.wallet, date__gte=min(dates), date__lte=max(dates)).values_list(
                "date", "amount"
            )
        )
        seen = Counter()
        created = []
        for movement in movements:
            key = (movement.date, movement.amount)
            seen[key] += 1
            if seen[key] > stored[key]:
                created.append(movement)
        return BankMovement.objects.bulk_create(created)
