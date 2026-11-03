export async function readPiUsage() {
  return {
    status: "unavailable",
    source: "Pi provider account",
    windows: [],
    message:
      "Pi uses the selected provider's OAuth or API account. Its session token and cost statistics do not report subscription quota percentages.",
  };
}
