import { builtInRules } from "../../shared/rule-templates.mjs";

// An unchanged built-in snapshot saves to the same library entry after reopening.
// An edited built-in creates a new copy; applied workflow snapshots stay independent.
export function libraryRulePayload(
  rule,
  custom,
  createId = () => `custom-${crypto.randomUUID()}`,
) {
  const builtIn = builtInRules.some((item) => item.id === rule.id);
  const identical =
    builtIn &&
    custom.find(
      (item) =>
        item.title.trim() === rule.title.trim() &&
        item.text.trim() === rule.text.trim(),
    );
  return {
    id: builtIn ? identical?.id || createId() : rule.id,
    title: rule.title,
    group: "My rules",
    text: rule.text,
  };
}
