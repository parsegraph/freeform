// Display metadata for the built-in recipes in examples.js. IDs are persisted
// recipe types, so changing a title never changes the generated document.
export const TEMPLATE_CATEGORIES = [
  "All",
  "Patterns",
  "Planning",
  "Brackets",
  "Documents",
  "Presentation",
];

export const TEMPLATE_CATALOG = [
  {
    id: "grid",
    name: "Grid",
    category: "Patterns",
    description: "A regular field of connected nodes.",
  },
  {
    id: "cross",
    name: "Recursive cross",
    category: "Patterns",
    description: "A branching cross repeated at smaller scales.",
  },
  {
    id: "rainbow",
    name: "Rainbow",
    category: "Patterns",
    description: "A horizontal spectrum of color.",
  },
  {
    id: "rainbow_vert",
    name: "Rainbow · vertical",
    category: "Patterns",
    description: "The color spectrum arranged vertically.",
  },
  {
    id: "rainbow_random",
    name: "Random colors",
    category: "Patterns",
    description: "A seeded, repeatable arrangement of colors.",
  },
  {
    id: "alt_columns",
    name: "Alternating columns",
    category: "Patterns",
    description: "Contrasting columns with a seeded layout.",
  },
  {
    id: "random",
    name: "Random graph",
    category: "Patterns",
    description: "Explore a seeded, branching graph.",
  },
  {
    id: "daily_planner_60",
    name: "Daily planner · hourly",
    category: "Planning",
    description: "Make space for the day, one hour at a time.",
  },
  {
    id: "daily_planner_30",
    name: "Daily planner · 30 minutes",
    category: "Planning",
    description: "A day divided into half-hour intervals.",
  },
  {
    id: "daily_planner_15",
    name: "Daily planner · 15 minutes",
    category: "Planning",
    description: "Plan the day in quarter-hour intervals.",
  },
  {
    id: "daily_planner_10",
    name: "Daily planner · 10 minutes",
    category: "Planning",
    description: "A detailed schedule in ten-minute intervals.",
  },
  {
    id: "daily_planner_5",
    name: "Daily planner · 5 minutes",
    category: "Planning",
    description: "A fine-grained schedule for the day.",
  },
  {
    id: "march",
    name: "Tournament",
    category: "Brackets",
    description: "Choose the rounds and orientation of a bracket.",
  },
  {
    id: "march_madness",
    name: "March Madness",
    category: "Brackets",
    description: "A horizontal basketball tournament bracket.",
  },
  {
    id: "march_madness_vert",
    name: "March Madness · vertical",
    category: "Brackets",
    description: "A basketball bracket arranged vertically.",
  },
  {
    id: "playoffs",
    name: "Playoffs",
    category: "Brackets",
    description: "A horizontal football playoff bracket.",
  },
  {
    id: "playoffs_vert",
    name: "Playoffs · vertical",
    category: "Brackets",
    description: "A football playoff bracket arranged vertically.",
  },
  {
    id: "json",
    name: "Sample JSON",
    category: "Documents",
    description: "Explore nested JSON as a graph.",
  },
  {
    id: "lisp",
    name: "Sample Lisp",
    category: "Documents",
    description: "Follow the structure of a Lisp program.",
  },
  {
    id: "svg",
    name: "SVG source",
    category: "Documents",
    description: "Explore XML elements, attributes, and content.",
  },
  {
    id: "proportion_v1",
    name: "Proportion",
    category: "Presentation",
    description: "Choose the width of a proportional composition.",
  },
  {
    id: "appearance_v1",
    name: "Appearance colors",
    category: "Presentation",
    description: "Node colors, transparency, and page appearance.",
  },
];

// Old sessions still restore these recipes, even though they are no longer
// presented as separate choices in the gallery.
const LEGACY_TEMPLATE_NAMES = {
  proportion_standard_v1: "Proportion · standard",
  proportion_math_v1: "Proportion · math",
  memory_piers_v1: "Memory Piers",
};

export function templateName(type) {
  if (type === "blank") return "Untitled graph";
  return (
    TEMPLATE_CATALOG.find((template) => template.id === type)?.name ||
    LEGACY_TEMPLATE_NAMES[type] ||
    type.replaceAll("_", " ")
  );
}
