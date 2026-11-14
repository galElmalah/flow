# List Flow in relevant directories

Research checked on 2026-11-14 against each repository's current README,
contribution rules and GitHub API metadata. Stars indicate audience size, not
traffic or a guarantee of acceptance. No submissions have been made.

Flow's published README links to the [public docs](https://gal.overto.run/flow-landing/docs/).
The GitHub About website now points there too. Discovery topics are `ai-agents`,
`generative-ai`, `image-generation`, `local-first`, `mcp-server`,
`video-generation` and `workflow-automation`.

## Submit these first

| Priority | List | Stars at check | Fit and submission route |
| --- | --- | ---: | --- |
| 1 | [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | 97,697 | Strong fit: installable local MCP server controlling visual workflows. Propose one alphabetized entry under Art & Culture in README.md. Follow the [contribution guide](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md). |
| 2 | [steven2358/awesome-generative-ai](https://github.com/steven2358/awesome-generative-ai) | 12,832 | Broad generative-media audience. Target DISCOVERIES.md → Image → Graphic design; the main list requires significant following or maintainer interest. Append one concise entry with an opensource tag. See [criteria](https://github.com/steven2358/awesome-generative-ai/blob/main/CONTRIBUTING.md). |
| 3 | [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) | 4,409 | Relevant MCP directory. It does not accept PRs: use [mcpservers.org/submit](https://mcpservers.org/submit). Free submission is available; a contact email is required. Flow uses local stdio, so leave remote support unchecked. |

Flow was not found in the checked READMEs or the Generative AI Discoveries file.
Recheck duplicates and current rules immediately before submitting.

### Draft entry for Awesome MCP Servers

```md
- [galElmalah/flow](https://github.com/galElmalah/flow) 📇 🏠 🍎 🐧 - Plan and run local image, GIF and video workflows with reference images, parallel batches, region editing and output lineage through MCP.
```

The icons describe JavaScript, a local platform, macOS and Linux. Windows is not
verified. Cloud inference is optional; provider accounts and API billing remain
separate from installing Flow. Do not claim an official MCP implementation badge.

### Draft entry for Generative AI Discoveries

```md
- [Flow](https://github.com/galElmalah/flow) - Local visual workflows for image, GIF and video generation, with CLI, JavaScript SDK, MCP tools, parallel batches and output lineage. #opensource
```

Link reviewers to [setup](../SETUP.md), [MCP configuration](mcp.md) and the existing
README screenshots. The no-account local-color demo gives reviewers a working
installation path without paid inference.

## Defer or skip

- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
  has 57,980 stars. Its [rules](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md)
  require 14 days since the first default-branch commit plus ongoing development,
  or 100 stars. Flow's root commit is dated November 3, so the age threshold is
  November 17, 2026. Recommendations must be created by a human through its issue
  form; do not submit a PR or automate that form.
- [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
  has 336,971 stars, but requires a first release older than four months. Flow has
  no GitHub release at this check. Its [contribution rules](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md)
  also prohibit generated submissions. Defer; do not prepare an entry for it.
- [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers)
  is archived. Skip it.
- [e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents)
  has 30,933 stars, but centers on autonomous agents. Flow is primarily their media
  workflow platform; prioritize the closer fits above.
- [Backblaze's image-generation list](https://github.com/backblaze-labs/awesome-image-generation)
  is relevant and accepts developer tools, but has only 10 stars at this check.
  Treat it as a niche secondary listing, not a popular traffic source.
