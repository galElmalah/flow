# Publishing documentation to Overto

Build the explainer and its documentation with:

```sh
node tools/build-explainer.mjs
```

The publication is a static multi-page site. Its entry is `launch/index.html`;
rendered documentation lives under `launch/guide/`, with four product images
under `images/`. The generated guide folder is ignored by Git. Markdown remains
the source. No application server, JavaScript router or GitHub login is needed
to read the bundled documentation through an authorized Overto share.

The builder checks every local page, image and stylesheet reference against the
publication's files. External links must open in a separate tab with `noopener`.
Run `node --test test/explainer.test.mjs` for the navigation regressions.

## The blocked-document incident

The original explainer's CLI/SDK and release-guide links pointed to GitHub with
ordinary anchors:

```html
<a href="https://github.com/galElmalah/flow/blob/main/docs/installation.md">
  CLI / SDK guide
</a>
```

Overto displays the published site inside an iframe. An anchor without a target
navigates that same iframe. Chrome therefore tried to display `github.com`
inside the Overto viewer and showed “This content is blocked.” GitHub's response
sets both `X-Frame-Options: deny` and CSP `frame-ancestors 'none'`, which prohibit
embedding. Repository access is a separate requirement; these framing headers
also apply to GitHub's unauthenticated error response.

The browser evidence was an outer **Flow — open-source release explainer** page
at the stable Overto address with a child frame titled **github.com** at
`chrome-error://chromewebdata/`. The published manifest contained one HTML page,
two JSON downloads and four images. It did not contain the documentation pages.

The authoring error was reusing repository links as the in-publication reading
path. The verification error was checking the entry page and asset inventories
without clicking the hosted documentation links. A successful publication and a
rendered entry page did not establish working navigation. The same missing
external-link target also appeared in the landing page's Docs/footer links.

The correction is explicit:

```html
<!-- Another declared page in the same publication -->
<a href="guide/docs/installation.html">CLI / SDK guide</a>

<!-- A different website -->
<a href="https://github.com/galElmalah/flow"
   target="_blank" rel="noopener noreferrer">Repository</a>
```

Preserve the existing audience and version fence when publishing the replacement.
Do not weaken CSP, proxy GitHub pages, or make private material public to bypass
an embedding error.

## Improvements for Overto

These are proposed platform changes, not claims that Flow changed Overto's core:

1. **Publication diagnostics:** warn about external anchors that navigate the
   content frame. Return the file, destination and suggested target in the MCP
   result. Separately validate local HTML/CSS/image paths against the manifest.
2. **A minimal multi-page example:** show `index.html`, `docs/setup.html` and
   their relative links in the publishing skill. Explain that canonical review
   URLs are different from bundle file paths, and document direct page links,
   refresh and back behavior.
3. **Navigation policy:** provide a documented external-link policy for authored
   sites, with a safe separate-tab default or an explicit authoring option.
   Avoid silently replacing requested application behavior.
4. **Useful failure UI:** when a framed external destination is blocked, retain
   the document, identify the destination and offer an explicit external-open
   action instead of leaving Chrome's generic error as the whole result.
5. **Hosted acceptance checks:** exercise internal links at nested paths,
   external links, browser back, reload, downloads and private access in the
   actual viewer, not only a direct local HTTP preview.

The immediate site fix belongs to this repository and publication. Product-level
diagnostics and navigation handling belong in Overto's publisher/viewer tests.
