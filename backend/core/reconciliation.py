import datetime
from collections import defaultdict

from core.models import BankMovement, Transaction

# How far the date of a transaction can be from the one of the bank, e.g. a card payment booked after a weekend
TOLERANCE = datetime.timedelta(days=5)


def match(movements, transactions):
    """
    Pairs the movements with the transactions of the same wallet and amount, the closest dates first; a transaction
    reconciles a single movement. Both are (id, wallet id, date, amount) tuples; returns the transaction ids by movement
    id.
    """
    # The movements and the transactions of each wallet and amount
    groups = defaultdict(lambda: ([], []))
    for item in movements:
        groups[item[1], item[3]][0].append(item)
    for item in transactions:
        if (item[1], item[3]) in groups:
            groups[item[1], item[3]][1].append(item)
    matches = {}
    for group_movements, group_transactions in groups.values():
        # Equal distances are settled by the older movement, then by the older transaction
        candidates = sorted(
            (abs(movement_date - date), movement_date, movement_id, transaction_id)
            for movement_id, _wallet, movement_date, _amount in group_movements
            for transaction_id, _wallet, date, _amount in group_transactions
            if abs(movement_date - date) <= TOLERANCE
        )
        used = set()
        for _distance, _date, movement_id, transaction_id in candidates:
            if movement_id not in matches and transaction_id not in used:
                matches[movement_id] = transaction_id
                used.add(transaction_id)
    return matches


def reconcile(wallets):
    """
    The transactions that reconcile the movements of the wallets, by movement id; the ignored movements are left out.

    Nothing is stored, so the transactions entered or changed later are reconciled as well.
    """
    movements = list(
        BankMovement.objects.filter(wallet__in=wallets, is_ignored=False).values_list("id", "wallet", "date", "amount")
    )
    if not movements:
        return {}
    dates = [date for _id, _wallet, date, _amount in movements]
    transactions = Transaction.objects.filter(
        wallet__in=wallets, date__gte=min(dates) - TOLERANCE, date__lte=max(dates) + TOLERANCE
    ).values_list("id", "wallet", "date", "amount")
    return match(movements, transactions)
