export function usageIsStale(account, now = Date.now()) {
  return Boolean(
    account?.stale ||
    (account?.checkedAt && now - Date.parse(account.checkedAt) > 120000) ||
    account?.windows?.some(
      (window) => window.resetAt && Date.parse(window.resetAt) <= now,
    ),
  );
}
