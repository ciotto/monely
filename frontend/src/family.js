// Helpers shared by the family balance and the transfers it suggests in the transaction list

export function memberName(member) {
  return [member.first_name, member.last_name].filter(Boolean).join(" ") || member.email;
}

// The transfer form gets the suggested amount, and the wallets when there is only one to choose: the personal one of
// the member and the joint one of the currency
export function transferQuery(currency, member) {
  const query = { amount: member.suggested };
  if (member.wallets.length === 1) {
    query.from_wallet = member.wallets[0];
  }
  if (currency.wallets.length === 1) {
    query.to_wallet = currency.wallets[0].id;
  }
  return query;
}

// The members that still have to transfer something this month, in every currency
export function pendingTransfers(balance) {
  return balance.currencies.flatMap((currency) =>
    currency.members
      .filter((member) => Number(member.suggested) > 0)
      .map((member) => ({ key: `${currency.id}-${member.id}`, currency, member })),
  );
}
