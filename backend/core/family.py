from decimal import Decimal

from django.db.models import Sum

from core.models import Contribution, Transaction, User, Wallet
from core.reports import add_months, amount


def personal_wallets():
    """The wallets that are not joint and have a single owner, as {id: (currency, owner)}."""
    return {
        wallet.pk: (wallet.currency, owners[0].pk)
        for wallet in Wallet.objects.filter(is_shared=False).prefetch_related("owners")
        if len(owners := wallet.owners.all()) == 1
    }


def build_family_balance(month):
    """
    How much each member of the family has to transfer to the joint wallets, so that they all contribute in equal
    measure; the members are all the active users, and amounts are never converted, so each currency is on its own.

    Every month from the first one of the contribution to the selected one, each member owes an equal share of it. They
    contribute with the transfers to any joint wallet from their personal wallets and with the shared expenses paid
    from them, net of the shared refunds. The totals are cumulative, so a settlement counts only once: whoever
    contributed more than due raises the level that the others have to reach.
    """
    end = add_months(month, 1)
    members = list(User.objects.filter(is_active=True).order_by("email"))
    personal = personal_wallets()
    archived = set(Wallet.objects.filter(is_archived=True).values_list("pk", flat=True))
    currencies = []
    for contribution in Contribution.objects.all():
        # The personal wallets in the currency of the contribution
        sources = {pk: owner for pk, (currency, owner) in personal.items() if currency == contribution.currency}
        transactions = Transaction.objects.filter(
            wallet__in=sources, date__gte=contribution.start_month, date__lt=end
        ).order_by()
        # The personal wallets that can still send a transfer, by owner
        active = {}
        for pk in sources.keys() - archived:
            active.setdefault(sources[pk], []).append(pk)
        totals = {
            "shared_expenses": transactions.filter(is_shared=True, transfer=None),
            # The outgoing legs of the transfers whose incoming leg is on a joint wallet
            "transfers": transactions.filter(amount__lt=0, transfer__transactions__wallet__is_shared=True),
        }
        paid = {(user.pk, field): Decimal(0) for user in members for field in totals}
        for field, queryset in totals.items():
            for row in queryset.values("wallet").annotate(total=Sum("amount")):
                # The owner of a personal wallet may not be active anymore
                if (sources[row["wallet"]], field) in paid:
                    paid[(sources[row["wallet"]], field)] -= row["total"]

        start = contribution.start_month
        months = max(0, (end.year - start.year) * 12 + end.month - start.month)
        # The members include who is asking, so they are never none
        due = (contribution.amount * months / len(members)).quantize(Decimal("0.01"))
        contributions = {user.pk: sum(paid[(user.pk, field)] for field in totals) for user in members}
        level = max([due, *contributions.values()])
        joint_wallets = Wallet.objects.filter(is_shared=True, is_archived=False, currency=contribution.currency)
        currencies.append(
            {
                "id": contribution.pk,
                "currency": contribution.currency,
                "amount": amount(contribution.amount),
                "start_month": start.strftime("%Y-%m"),
                "months": months,
                "due": amount(due),
                "level": amount(level),
                # Where the members can transfer their share
                "wallets": [{"id": wallet.pk, "name": wallet.name} for wallet in joint_wallets.order_by("name")],
                "members": [
                    {
                        "id": user.pk,
                        "email": user.email,
                        "first_name": user.first_name,
                        "last_name": user.last_name,
                        "transfers": amount(paid[(user.pk, "transfers")]),
                        "shared_expenses": amount(paid[(user.pk, "shared_expenses")]),
                        "paid": amount(contributions[user.pk]),
                        "suggested": amount(level - contributions[user.pk]),
                        "wallets": sorted(active.get(user.pk, [])),
                    }
                    for user in members
                ],
            }
        )
    return {"month": month.strftime("%Y-%m"), "currencies": currencies}
