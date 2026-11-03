import React, { useEffect, useRef, useState } from "react";
import { ListChecks, Plus, Trash2, ChevronDown } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { jsonRequest } from "../studio/ui.mjs";
import {
  addRuleTemplates,
  builtInRules,
  inheritedRules,
  mergeRules,
  rulePresets,
  rulesText,
  ruleConflicts,
} from "../../shared/rule-templates.mjs";
import { libraryRulePayload } from "./rule-library.mjs";
import "../rule-templates.css";

export function RuleTemplates({
  node,
  nodes,
  edges,
  onChange,
  readOnly,
  sectionRef,
}) {
  const [catalog, setCatalog] = useState({
    builtIn: builtInRules,
    custom: [],
    presets: rulePresets,
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRule = useRef(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const rules = node.data.rules || [];
  const inherited = mergeRules(inheritedRules(node.id, nodes, edges));
  const enabled = mergeRules(inherited, rules);
  const conflicts = ruleConflicts(node.id, nodes, edges);
  useEffect(() => {
    let live = true;
    jsonRequest("/api/rule-templates")
      .then((value) => {
        if (live) setCatalog(value);
      })
      .catch((err) => {
        if (live) setError(err.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const change = (next) => {
    if (readOnly) return false;
    setError("");
    setMessage("");
    if (next.length > 40) {
      setError("Keep at most 40 rules on one node.");
      return false;
    }
    onChange({ rules: next });
    return true;
  };
  const update = (id, patch) =>
    change(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = (items) => {
    if (change(addRuleTemplates(rules, items)))
      setMessage("Added to this node. Existing rule text stays unchanged.");
  };
  const save = async (rule) => {
    if (readOnly || savingRule.current) return;
    savingRule.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await jsonRequest("/api/rule-templates", {
        method: "POST",
        body: JSON.stringify(libraryRulePayload(rule, catalog.custom)),
      });
      setCatalog((c) => ({
        ...c,
        custom: [...c.custom.filter((r) => r.id !== saved.id), saved],
      }));
      setMessage(
        `Saved “${saved.title}” to the local library. Existing workflows keep their own copies.`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      savingRule.current = false;
      setSaving(false);
    }
  };
  const all = [...catalog.builtIn, ...catalog.custom];
  return (
    <section
      ref={sectionRef}
      className="rule-templates"
      aria-label="Rules & templates"
    >
      <div className="rules-heading">
        <ListChecks size={16} />
        <h3>Rules & templates</h3>
        <span>{enabled.length} enabled</span>
      </div>
      <p className="rules-description">
        Rules apply to downstream scene writing and image generation.
      </p>
      {!readOnly && (
        <div className="rule-pickers">
          <Autocomplete
            label="Add a rule template"
            value=""
            disabled={saving}
            options={[
              { value: "", label: "Add a rule…", disabled: true },
              ...all.map((r) => ({
                value: r.id,
                label: r.title,
                description: r.group,
                keywords: `${r.group} ${r.text}`,
                disabled: rules.some((x) => x.id === r.id),
              })),
            ]}
            onChange={(id) => add(all.filter((r) => r.id === id))}
          />
          <Autocomplete
            label="Apply a rule preset"
            value=""
            disabled={saving}
            options={[
              { value: "", label: "Or choose a preset…", disabled: true },
              ...catalog.presets.map((p) => ({
                value: p.id,
                label: p.title,
                description: `${p.rules.length} rules`,
              })),
            ]}
            onChange={(id) => {
              const preset = catalog.presets.find((p) => p.id === id);
              if (preset)
                add(catalog.builtIn.filter((r) => preset.rules.includes(r.id)));
            }}
          />
        </div>
      )}
      {rules.length === 0 && <p className="rules-empty">No rules.</p>}
      <div className="applied-rules">
        {rules.map((rule) => (
          <details className="applied-rule" key={rule.id}>
            <summary>
              <input
                type="checkbox"
                aria-label={`Enable ${rule.title}`}
                checked={rule.enabled !== false}
                disabled={readOnly}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => update(rule.id, { enabled: e.target.checked })}
              />
              <span>{rule.title}</span>
              <ChevronDown size={13} />
            </summary>
            <div className="rule-editor">
              <label>
                Rule name
                <input
                  aria-label={`Rule name: ${rule.title}`}
                  maxLength={100}
                  readOnly={readOnly}
                  value={rule.title}
                  onChange={(e) => update(rule.id, { title: e.target.value })}
                />
              </label>
              <label>
                Exact instructions
                <textarea
                  aria-label={`Instructions for ${rule.title}`}
                  maxLength={4000}
                  rows={5}
                  readOnly={readOnly}
                  value={rule.text}
                  onChange={(e) => update(rule.id, { text: e.target.value })}
                />
              </label>
              {!readOnly && (
                <div className="rule-actions">
                  <button
                    disabled={saving || !rule.title.trim() || !rule.text.trim()}
                    onClick={() => save(rule)}
                  >
                    Save to library
                  </button>
                  <button
                    aria-label={`Remove ${rule.title}`}
                    onClick={() =>
                      change(rules.filter((r) => r.id !== rule.id))
                    }
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
      {inherited.length > 0 && (
        <details className="inherited-rules">
          <summary>{inherited.length} inherited rules</summary>
          <p>
            Edit these at their source node. Disabling a local copy does not
            disable an upstream rule.
          </p>
          {inherited.map((rule, i) => (
            <div className="inherited-rule" key={`${rule.id}-${i}`}>
              <strong>{rule.title}</strong>
              <small>From {rule.sourceLabel}</small>
              <p>{rule.text}</p>
            </div>
          ))}
        </details>
      )}
      {enabled.length > 0 && (
        <details className="inherited-rules">
          <summary>Preview combined rules</summary>
          <pre className="rules-preview">{rulesText(enabled)}</pre>
        </details>
      )}
      {!readOnly && (
        <details className="custom-rule-composer">
          <summary>
            <Plus size={13} /> Create a custom rule
          </summary>
          <label>
            Name
            <input
              aria-label="Custom rule name"
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Keep the horizon clear"
            />
          </label>
          <label>
            Instructions
            <textarea
              aria-label="Custom rule instructions"
              rows={4}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe the rule in plain language…"
            />
          </label>
          <button
            disabled={!title.trim() || !text.trim() || rules.length >= 40}
            onClick={() => {
              add([
                {
                  id: `custom-${crypto.randomUUID()}`,
                  title: title.trim(),
                  text: text.trim(),
                  group: "My rules",
                },
              ]);
              setTitle("");
              setText("");
            }}
          >
            Add to this node
          </button>
        </details>
      )}
      {conflicts.map((message) => (
        <p className="rules-note" key={message}>
          {message}
        </p>
      ))}
      <p className="rules-note">
        Rules guide generation; they do not verify unique faces or scenery
        across outputs. Use different scene and cast fields per record for
        explicit batch variation.
      </p>
      {message && (
        <p className="rule-feedback" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="rule-feedback" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
