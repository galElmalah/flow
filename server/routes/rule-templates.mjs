import { builtInRules, rulePresets } from "../../shared/rule-templates.mjs";

export function registerRuleTemplateRoutes(app, { store }) {
  app.get("/api/rule-templates", (_, res) =>
    res.json({
      builtIn: builtInRules,
      custom: store.listRuleTemplates(),
      presets: rulePresets,
    }),
  );
  app.post("/api/rule-templates", (req, res) =>
    res.json(store.saveRuleTemplate(req.body)),
  );
}
