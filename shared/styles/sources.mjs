// Curated source links checked 2026-10-30. Links do not grant image reuse rights.
export const styleSourceCollections = [
  {
    id: "artic",
    name: "Art Institute of Chicago",
    url: "https://www.artic.edu/collection",
    policyUrl: "https://api.artic.edu/docs/",
    group: "Reusable assets",
    description: "Historical painting, cubism, prints and sculpture.",
    reuse:
      "Use artworks explicitly marked public domain / CC0; other images have separate rights.",
  },
  {
    id: "smithsonian",
    name: "Smithsonian Open Access",
    url: "https://www.si.edu/openaccess",
    policyUrl: "https://www.si.edu/openaccess/faq",
    group: "Reusable assets",
    description: "Objects, natural history, photography and decorative arts.",
    reuse:
      "Use individual assets designated CC0. Retain the object source and credit.",
  },
  {
    id: "cleveland",
    name: "Cleveland Museum of Art",
    url: "https://www.clevelandart.org/art/collection/search",
    policyUrl: "https://www.clevelandart.org/open-access-api",
    group: "Reusable assets",
    description: "Historic art, painting, design and ornamental materials.",
    reuse:
      "Choose works explicitly carrying the museum's CC0 open-access designation.",
  },
  {
    id: "rawpixel",
    name: "Rawpixel Public Domain",
    url: "https://www.rawpixel.com/public-domain",
    policyUrl: "https://www.rawpixel.com/public-domain",
    group: "Reusable assets",
    description:
      "Botanical plates, textures, vintage illustration and fine art.",
    reuse:
      "The linked public-domain collection states CC0; do not assume the rest of the site is CC0.",
  },
  {
    id: "polyhaven",
    name: "Poly Haven",
    url: "https://polyhaven.com/",
    policyUrl: "https://polyhaven.com/license",
    group: "Reusable assets",
    description: "Realistic materials, lighting environments and 3D assets.",
    reuse:
      "Downloadable assets are CC0. Site example renders are separate; API access has its own terms.",
  },
  {
    id: "ambientcg",
    name: "ambientCG",
    url: "https://ambientcg.com/",
    policyUrl: "https://docs.ambientcg.com/license/",
    group: "Reusable assets",
    description: "Concrete, fabric, metal and natural material references.",
    reuse: "Assets and material preview renders are provided under CC0.",
  },
  {
    id: "commons",
    name: "Wikimedia Commons",
    url: "https://commons.wikimedia.org/",
    policyUrl: "https://commons.wikimedia.org/wiki/Commons:Licensing",
    group: "Reusable assets",
    description:
      "Architecture, brutalist buildings, objects and historic images.",
    reuse:
      "Check each file's license, attribution and any share-alike conditions.",
  },
  {
    id: "midlibrary",
    name: "Midlibrary",
    url: "https://midlibrary.io/",
    policyUrl: "https://midlibrary.io/help/questions",
    group: "Style inspiration",
    description:
      "Visual languages, moods, techniques and style-reference exploration.",
    reuse:
      "Inspiration link only. The site requests permission before reusing its materials; model-specific codes do not transfer automatically.",
  },
  {
    id: "publicprompts",
    name: "Public Prompts",
    url: "https://www.publicprompts.art/",
    group: "Style inspiration",
    description: "Prompt examples and visual-generation approaches.",
    reuse:
      "Review the terms for each prompt, model or image; no blanket image-reuse permission is assumed.",
  },
  {
    id: "openart",
    name: "OpenArt Prompt Book",
    url: "https://openart.ai/promptbook",
    group: "Style inspiration",
    description: "Composition, lighting and image-prompt construction.",
    reuse:
      "A learning and inspiration resource; verify rights before importing any example image.",
  },
  {
    id: "neobrutalism",
    name: "Neobrutalism components",
    url: "https://www.neobrutalism.dev/",
    group: "Style inspiration",
    description: "Hard offset shadows, strong outlines and bold flat palettes.",
    reuse:
      "Design inspiration. Component-code licenses do not automatically grant rights to every displayed asset.",
  },
  {
    id: "adsoftheworld",
    name: "Ads of the World",
    url: "https://www.adsoftheworld.com/",
    group: "Advertising inspiration",
    description: "Sports, product and brand campaigns with agency context.",
    reuse:
      "Campaigns are third-party creative work. Study composition and strategy; use original or licensed production assets.",
  },
  {
    id: "meta-ads",
    name: "Meta Ad Library",
    url: "https://www.facebook.com/ads/library/",
    group: "Advertising inspiration",
    description: "Browse advertiser creative across Meta placements.",
    reuse:
      "Public visibility is not an image-reuse license. Access and filters may vary.",
  },
  {
    id: "tiktok-ads",
    name: "TikTok Creative Center",
    url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en",
    policyUrl:
      "https://ads.tiktok.com/resources/help/article/how-to-use-the-top-ads-dashboard",
    group: "Advertising inspiration",
    description:
      "Ad hooks, creator formats, products and campaign composition.",
    reuse:
      "Study campaign patterns. Do not treat advertiser footage, talent or music as cleared production assets.",
  },
  {
    id: "mobbin",
    name: "Mobbin",
    url: "https://mobbin.com/",
    group: "Advertising inspiration",
    description:
      "Real app screens and product flows for app campaign research.",
    reuse:
      "App-interface inspiration, not a stock-image license. Use your own app screenshots in finished ads.",
  },
];

export function sourceIdsForStyle(style) {
  if (style.category === "Advertising & campaigns")
    return ["adsoftheworld", "meta-ads", "tiktok-ads", "mobbin"];
  if (style.id === "neo-brutalism") return ["neobrutalism", "midlibrary"];
  if (style.id === "brutalism") return ["commons", "ambientcg"];
  if (style.category === "3D & materials") return ["polyhaven", "ambientcg"];
  if (style.category === "Photography") return ["commons", "smithsonian"];
  return ["artic", "cleveland", "rawpixel", "midlibrary"];
}
