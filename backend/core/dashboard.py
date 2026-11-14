from django.db.models import Q, Sum

from core.budgets import build_budgets
from core.models import Transaction, Wallet
from core.reports import add_months, amount

# Amounts are never converted, so every total is computed per currency
INCOME = Sum("amount", filter=Q(amount__gt=0), default=0)
EXPENSES = Sum("amount", filter=Q(amount__lt=0), default=0)


def totals(transactions, month):
    """The income and the expenses of the month, by currency and category; transfers are neither."""
    rows = (
        transactions.filter(transfer=None, date__gte=month, date__lt=add_months(month, 1))
        .values("wallet__currency", "category")
        .annotate(income=INCOME, expenses=EXPENSES)
        .order_by()
    )
    return {(row["wallet__currency"], row["category"]): row for row in rows}


def build_dashboard(month, wallet=None):
    """
    Summarizes a month: the totals are compared with the same month of the previous year, the categories also with the
    previous month. The budgets cover all the wallets, so they are left out when one is chosen.

    The balances of the wallets are computed at the end of the month; archived wallets are listed only when chosen.
    """
    transactions = Transaction.objects.all()
    wallets = Wallet.objects.filter(is_archived=False)
    if wallet is not None:
        transactions = transactions.filter(wallet=wallet)
        wallets = Wallet.objects.filter(pk=wallet.pk)
    # The fields of the current month have no prefix, e.g. `income` and `previous_month_income`
    periods = {"": month, "previous_month_": add_months(month, -1), "previous_year_": add_months(month, -12)}
    period_totals = {prefix: totals(transactions, start) for prefix, start in periods.items()}
    keys = set().union(*period_totals.values())
    budgets = build_budgets(month)["budgets"] if wallet is None else []

    # A currency is shown when a wallet uses it, or when it has transactions to compare or budgets
    currencies = sorted(
        {currency for currency, _ in keys}
        | set(wallets.values_list("currency", flat=True))
        | {budget["currency"] for budget in budgets}
    )
    empty = {"income": 0, "expenses": 0}
    summaries = []
    for currency in currencies:
        # The transactions without a category come last
        categories = sorted(
            {category for key_currency, category in keys if key_currency == currency},
            key=lambda category: (category is None, category or 0),
        )
        rows = []
        for category in categories:
            row = {"category": category}
            for prefix, values in period_totals.items():
                values = values.get((currency, category), empty)
                row[f"{prefix}income"] = values["income"]
                row[f"{prefix}expenses"] = values["expenses"]
            rows.append(row)

        def total(field):
            return sum(row[field] for row in rows)

        summaries.append(
            {
                "currency": currency,
                "income": amount(total("income")),
                "expenses": amount(total("expenses")),
                "net": amount(total("income") + total("expenses")),
                "previous_year": {
                    "income": amount(total("previous_year_income")),
                    "expenses": amount(total("previous_year_expenses")),
                    "net": amount(total("previous_year_income") + total("previous_year_expenses")),
                },
                "categories": [
                    {key: value if key == "category" else amount(value) for key, value in row.items()} for row in rows
                ],
                "budgets": [budget for budget in budgets if budget["currency"] == currency],
            }
        )

    # Meta.ordering is ignored by aggregation queries, so the order is explicit
    balances = wallets.annotate(
        balance=Sum("transactions__amount", filter=Q(transactions__date__lt=add_months(month, 1)), default=0)
    ).order_by("name")
    return {
        "month": month.strftime("%Y-%m"),
        "previous_month": periods["previous_month_"].strftime("%Y-%m"),
        "previous_year": periods["previous_year_"].strftime("%Y-%m"),
        "currencies": summaries,
        "wallets": [
            {"id": item.pk, "name": item.name, "currency": item.currency, "balance": amount(item.balance)}
            for item in balances
        ],
    }
