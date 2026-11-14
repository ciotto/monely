"""Helpers shared by the monthly reports: the dashboard and the budgets."""


def add_months(month, months):
    """Returns the first day of the month `months` away from `month`, itself the first day of a month."""
    index = month.year * 12 + month.month - 1 + months
    return month.replace(year=index // 12, month=index % 12 + 1)


def amount(value):
    return f"{value:.2f}"
