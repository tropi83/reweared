import type { Recipe } from "@/domain/models";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_ -]+?)\s*\}\}/g;

/** Unique variable names in a template, in order of first appearance. */
export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]?.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

/**
 * Fills `{{variable}}` placeholders. Unfilled variables are removed and surrounding
 * whitespace collapsed so the prompt still reads naturally.
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template
    .replace(VARIABLE_PATTERN, (_, raw: string) => values[raw.trim()]?.trim() ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

const now = "2026-01-01T00:00:00.000Z";

export const BUILT_IN_RECIPES: Recipe[] = [
  {
    id: "rcp_builtin_product_studio",
    name: "Product Studio",
    description: "Clean studio shot on a seamless background.",
    category: "product",
    promptTemplate:
      "Place this product in a professional photo studio on a seamless {{background color}} background. Soft three-point lighting, subtle contact shadow, product perfectly centered, sharp focus, no text, no props. Keep the product's shape, colors and branding exactly unchanged.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "rcp_builtin_product_photography",
    name: "Product Photography",
    description: "Lifestyle product photo in a natural setting.",
    category: "product",
    promptTemplate:
      "Photograph this product in a {{setting}} with natural light, shallow depth of field and realistic reflections. Keep the product exactly as it is; only change the environment and lighting. Commercial photography quality.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "rcp_builtin_editorial_portrait",
    name: "Editorial Portrait",
    description: "Magazine-style portrait lighting and grading.",
    category: "portrait",
    promptTemplate:
      "Turn this into an editorial magazine portrait: {{lighting}} lighting, cinematic color grading, refined skin texture without smoothing, shallow depth of field. Preserve the person's identity, expression and clothing.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "rcp_builtin_luxury_ad",
    name: "Luxury Advertisement",
    description: "High-end advertising composition.",
    category: "advertising",
    promptTemplate:
      "Create a luxury advertising visual around this product: {{material}} surfaces, dramatic rim lighting, elegant negative space for headline copy, premium and minimal. Keep the product unchanged and prominent.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "rcp_builtin_background_replacement",
    name: "Background Replacement",
    description: "Swap the background, keep the subject.",
    category: "background",
    promptTemplate:
      "Replace the background with {{new background}}. Keep the main subject exactly unchanged, including its edges, shadows and lighting direction, so the composite looks natural.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "rcp_builtin_interior_design",
    name: "Interior Design",
    description: "Restyle a room in a given style.",
    category: "interior",
    promptTemplate:
      "Redesign this room in a {{style}} interior style. Keep the room's architecture, windows and perspective unchanged; update furniture, materials, colors and decoration. Photorealistic, natural daylight.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "rcp_builtin_social_media",
    name: "Social Media",
    description: "Scroll-stopping social visual.",
    category: "social",
    promptTemplate:
      "Make this image a vibrant social media visual for {{platform}}: bold colors, high contrast, clean composition with space for a short caption. Keep the subject recognizable.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "rcp_builtin_ecommerce",
    name: "E-commerce",
    description: "Marketplace-ready pack shot.",
    category: "ecommerce",
    promptTemplate:
      "Create an e-commerce pack shot of this product on a pure white background, evenly lit, no shadows except a faint soft contact shadow, centered with even margins. Keep the product exactly unchanged.",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
];
