export const starter = {
  id: "paper-studies",
  name: "Paper explorations",
  nodes: [
    {
      id: "seed",
      type: "image",
      position: { x: 0, y: 65 },
      data: { label: "Seed image", images: ["/assets/paper-seed.png"] },
    },
    {
      id: "prompt",
      type: "prompt",
      position: { x: 0, y: 445 },
      data: {
        label: "Art direction",
        text: "An abstract study of light and color. Soft, flowing gradients with rich paper grain. Let warm apricot melt into electric blue and lavender. Tactile, atmospheric, beautifully imperfect.\n\nPreserve the mood of the reference. No text, no objects.",
      },
    },
    {
      id: "variations",
      type: "variations",
      position: { x: 380, y: 445 },
      data: {
        label: "Explore the palette",
        lines:
          "Cobalt blue + warm apricot\nLavender + burnt orange\nAcid yellow + deep violet\nDusty rose + midnight blue",
      },
    },
    {
      id: "generate",
      type: "generate",
      position: { x: 780, y: 65 },
      data: {
        label: "Image generation",
        count: 25,
        seed: 4200,
        ratio: "1:1",
        quality: "high",
        preview: "/assets/paper-seed.png",
      },
    },
    {
      id: "output",
      type: "output",
      position: { x: 1200, y: 65 },
      data: { label: "Output collection" },
    },
  ],
  edges: [
    {
      id: "seed-gen",
      source: "seed",
      target: "generate",
      sourceHandle: "image",
      targetHandle: "image",
    },
    {
      id: "prompt-var",
      source: "prompt",
      target: "variations",
      sourceHandle: "text",
      targetHandle: "text",
    },
    {
      id: "var-gen",
      source: "variations",
      target: "generate",
      sourceHandle: "text",
      targetHandle: "text",
    },
    {
      id: "gen-out",
      source: "generate",
      target: "output",
      sourceHandle: "image",
      targetHandle: "image",
    },
  ],
};
