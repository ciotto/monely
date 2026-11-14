from collections import defaultdict

from django.db.models import Q, Sum

from core.dashboard import add_months, amount
from core.models import Budget, RecurringTransaction, Transaction


def build_budgets(month):
    """
    The budgets of a month with what their categories spent, in the currency of each budget; the expenses are positive
    and the refunds in the same category reduce them.

    The recurring transactions count with their monthly share in every month from their start to their end, even when
    no occurrence is due, so that e.g. a yearly bill weighs on the whole year instead of the month in which it is paid:
    the transactions that register their occurrences are left out, not to count them twice.
    """
    end = add_months(month, 1)
    rows = (
        Transaction.objects.filter(transfer=None, recurring_transaction=None, date__gte=month, date__lt=end)
        .exclude(category=None)
        .values("wallet__currency", "category")
        .annotate(total=Sum("amount"))
        .order_by()
    )
    spent = {(row["wallet__currency"], row["category"]): -row["total"] for row in rows}
    recurring = defaultdict(list)
    for item in (
        RecurringTransaction.objects.select_related("wallet")
        .exclude(category=None)
        .filter(Q(end_date=None) | Q(end_date__gte=month), start_date__lt=end)
        .order_by("description", "id")
    ):
        recurring[(item.wallet.currency, item.category_id)].append(item)

    budgets = []
    for budget in Budget.objects.all():
        key = (budget.currency, budget.category_id)
        shares = [
            {"id": item.pk, "description": item.description, "share": -item.monthly_amount} for item in recurring[key]
        ]
        transactions = spent.get(key, 0)
        recurring_total = sum(share["share"] for share in shares)
        budgets.append(
            {
                "id": budget.pk,
                "category": budget.category_id,
                "currency": budget.currency,
                "amount": amount(budget.amount),
                "transactions": amount(transactions),
                "recurring": amount(recurring_total),
                "spent": amount(transactions + recurring_total),
                "remaining": amount(budget.amount - transactions - recurring_total),
                "recurring_transactions": [{**share, "share": amount(share["share"])} for share in shares],
            }
        )
    return {"month": month.strftime("%Y-%m"), "budgets": budgets}
