// The ONLY settings an admin may change from the dashboard. It's a strict
// allow-list on purpose: the dashboard must never be able to overwrite things
// like JWT_SECRET, MONGODB_URI or the Stripe keys.
//
//  secret          — encrypted at rest, never shown again (only the last 4 chars)
//  needsRestart    — the code reads this value once at startup, so a change only
//                    takes effect after the next deploy/restart
//  sharedWithGarmentService — also handed to garment-service through
//                    GET /api/internal/provider-keys
const PROVIDER_GROUPS = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Used for garment part segmentation in the Garment Tool.",
    fields: [{ name: "OPENAI_API_KEY", label: "API key", secret: true, sharedWithGarmentService: true }],
  },
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    description: "Claude vision / workspace AI.",
    fields: [
      { name: "ANTHROPIC_API_KEY", label: "API key", secret: true },
      { name: "ANTHROPIC_VISION_MODEL", label: "Vision model", secret: false, placeholder: "claude-sonnet-4-5" },
      { name: "AI_VISION_PROVIDER", label: "Vision provider", secret: false, placeholder: "auto" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Fibo assistant, Pose Tool and pattern design.",
    fields: [
      { name: "GEMINI_API_KEY", label: "API key", secret: true },
      { name: "GEMINI_MODEL", label: "Text / vision model", secret: false, needsRestart: true, placeholder: "gemini-3.6-flash" },
      { name: "GEMINI_IMAGE_MODEL", label: "Image model", secret: false, needsRestart: true, placeholder: "gemini-2.5-flash-image" },
    ],
  },
  {
    id: "huggingface",
    label: "Hugging Face / segmentation",
    description: "Hosted garment-part segmentation.",
    fields: [
      { name: "HF_TOKEN", label: "Hugging Face token", secret: true, sharedWithGarmentService: true },
      { name: "GARMENT_SEGMENTATION_URL", label: "Segmentation service URL", secret: false, sharedWithGarmentService: true },
      { name: "GARMENT_SEGMENTATION_TOKEN", label: "Segmentation service token", secret: true, sharedWithGarmentService: true },
    ],
  },
  {
    id: "photos",
    label: "Photo search",
    description: "Inspiration Library + gallery photos.",
    fields: [
      { name: "UNSPLASH_ACCESS_KEY", label: "Unsplash access key", secret: true },
      { name: "PEXELS_API_KEY", label: "Pexels API key", secret: true },
    ],
  },
  {
    id: "pinterest",
    label: "Pinterest",
    description: "Company-scoped Pinterest connection.",
    fields: [
      { name: "PINTEREST_CLIENT_ID", label: "Client ID", secret: false },
      { name: "PINTEREST_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
];

const FIELD_BY_NAME = new Map();
for (const g of PROVIDER_GROUPS) for (const f of g.fields) FIELD_BY_NAME.set(f.name, { ...f, group: g.id });

module.exports = { PROVIDER_GROUPS, FIELD_BY_NAME, isManageable: (name) => FIELD_BY_NAME.has(name) };
