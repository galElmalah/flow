# Security

Flow is a local application for a trusted operating-system account. It binds to loopback and checks HTTP host and origin headers. It does not provide multi-user authentication. Do not expose it through a public reverse proxy or treat project scoping as an access boundary between untrusted users.

Provider keys, OAuth connections, generated assets and conversations belong in the ignored `.flow/` directory. Other data directories configured with `FLOW_DATA_DIR` need the same protection. Keys are readable by the local account. CLI harnesses execute local processes; image generation can use a writable job directory. Only configure commands and model sources you trust.

Cloud providers receive the prompts and references you send to them. Local runtimes do not automatically fall back to a cloud provider. Model downloads have their own licenses and hardware requirements.

## Report a vulnerability

Do not put exploit details or credentials in a public issue. Use [GitHub private vulnerability reporting](https://github.com/galElmalah/flow/security/advisories/new) when it is available. If private reporting is unavailable, open an issue that asks for a private channel without including the vulnerability details.

The project is pre-release. Security fixes target the current main branch; there is no supported release series yet.
