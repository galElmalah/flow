export const PROVIDER_NOT_READY = "PROVIDER_NOT_READY";
export class ProviderRequirementsError extends Error {
  constructor(blockers) {
    super(
      "Cannot start run. " +
        blockers
          .map((blocker) => `${blocker.name}: ${blocker.message}`)
          .join("; "),
    );
    this.name = "ProviderRequirementsError";
    this.status = 412;
    this.code = PROVIDER_NOT_READY;
    this.blockers = blockers;
  }
}

// Keep actionable provider metadata across the HTTP/client boundary. Never trust
// a response's arbitrary URL as a settings destination.
export function providerFailureFields(value) {
  if (value?.code !== PROVIDER_NOT_READY || !Array.isArray(value.blockers))
    return {};
  const blockers = value.blockers
    .filter(
      (blocker) =>
        blocker &&
        typeof blocker.providerId === "string" &&
        typeof blocker.name === "string" &&
        typeof blocker.message === "string",
    )
    .map((blocker) => ({
      providerId: blocker.providerId,
      name: blocker.name,
      message: blocker.message,
      nodeIds: Array.isArray(blocker.nodeIds)
        ? blocker.nodeIds.filter((id) => typeof id === "string")
        : [],
      setupPath:
        blocker.setupPath === "/settings/local-models"
          ? blocker.setupPath
          : "/settings/providers",
    }));
  return blockers.length ? { code: PROVIDER_NOT_READY, blockers } : {};
}
