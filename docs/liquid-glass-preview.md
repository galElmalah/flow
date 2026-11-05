# Canvas glass preview

Open `/demos/liquid-glass/` on the local Flow server. This is an isolated material
prototype using the bundled `public/assets/paper-seed.png` texture. Four sample views
use browser color filters and illustrative scene descriptions. The preview has no
project IDs, private uploads, or recorded runs. It never writes workflows or starts inference.
The main app does not import its stylesheet or script.

Compare **Current**, **Frosted**, and **Liquid**. Drag the canvas or use **Slide artwork
behind glass** to compare the same surfaces over different content. Sidebars can close
and reopen, the library search filters its choices, and collection images update the
inspector. The prompt summaries are illustrative preview copy, not production lineage.

## Recommendation

Use the Liquid prototype's smoked surface for floating sidebars: a dark translucent
fill, moderate backdrop blur, a restrained bright rim, inset highlights, and a soft
shadow. Keep the canvas nodes opaque. Let the actual artwork supply any transmitted
color rather than tinting every panel or adding a decorative color wash.

Use one filtered surface per panel, and ordinary translucent fills for its internal
sections. Animate transform/opacity for opening and closing. Pointer-driven reflections
are scheduled once per animation frame and stop when the pointer leaves. No animation
loop or framework dependency is added. These choices still need profiling against the
real moving canvas before integration; this preview makes no measured performance claim.

The prototype includes an opaque fallback, a Reduce transparency control, and CSS
preferences for reduced transparency, increased contrast and reduced motion. Library
content scrolls when height is limited; at narrow widths only one sidebar is active.
Closed sidebars are inert and hidden from the accessibility tree.

## Research

- [Apple: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
  places Liquid Glass in the controls/navigation layer. Its regular material is the
  appropriate starting point for text-heavy sidebars; clear glass needs a media-rich
  backdrop and sufficient contrast.
- [Apple: Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)
  describes reflected light, fluid transitions and the performance cost of excessive
  effects. Native SwiftUI effects are not directly available to this browser app.
- [MDN: backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)
  describes the broadly available CSS foundation. Ancestors using opacity, filters or
  masks can create backdrop roots and prevent a panel from sampling the intended canvas.
- [GoogleChromeLabs: liquid-glass reference](https://github.com/GoogleChromeLabs/css-web-ui-demos/blob/main/html-in-canvas/public/assets/liquid_glass_reference/README.md)
  demonstrates actual lens distortion through SVG displacement and specular maps.
- [WebKit issue 245510](https://bugs.webkit.org/show_bug.cgi?id=245510), still open when
  researched on 2026-11-02, documents unresolved SVG backdrop-filter behavior. Treat real
  refraction as an optional, separately verified enhancement, not the baseline.

The Liquid prototype is a CSS approximation of the material. It does not claim native
Apple rendering or physical refraction. Do not enable URL-based SVG backdrop filters
solely because `CSS.supports()` accepts the syntax; that does not prove correct rendering.

## Verification

Open the preview in a fresh local workspace. Check all three materials, library
search, each sample view, sidebar close and reopen, canvas movement, and the opaque
fallback. Confirm that every image loads without workspace uploads or saved runs.
Inspect desktop and narrow layouts for horizontal document overflow.

The expected backdrop filter is `none` in Current, `blur(30px)` in Frosted, and
`none` with Reduce transparency. Sample color filters are separate from the glass
backdrop filter. Run `node tools/check-doc-links.mjs` to check local Markdown links.

Sources: `public/demos/liquid-glass/index.html`, `preview.css`, and `preview.js`.
The production build copies these files unchanged to `dist/demos/liquid-glass/`.
