import { useMemo, useState } from "react";
import { TEMPLATE_CATALOG, TEMPLATE_CATEGORIES } from "../templateCatalog";

const previewBase = `${(process.env.PUBLIC_URL || "").replace(
  /\/+$/,
  ""
)}/template-previews`;

export default function TemplateGallery({ selected, onSelect, disabled }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const templates = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return TEMPLATE_CATALOG.filter((template) => {
      const text =
        `${template.name} ${template.description} ${template.category}`.toLowerCase();
      return (
        (category === "All" || template.category === category) &&
        words.every((word) => text.includes(word))
      );
    });
  }, [query, category]);

  return (
    <section
      className="template-gallery"
      aria-labelledby="template-gallery-title"
    >
      <div className="template-gallery-heading">
        <div className="document-section-heading">
          <h3 id="template-gallery-title">Templates &amp; examples</h3>
          <p>Choose a starting point. Make it your own.</p>
        </div>
        <input
          className="template-search"
          type="search"
          aria-label="Search templates"
          placeholder="Search templates…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        />
      </div>
      <div className="template-categories" aria-label="Template categories">
        {TEMPLATE_CATEGORIES.map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="template-grid" aria-label="Templates">
        {templates.map((template) => (
          <button
            type="button"
            className="template-card"
            key={template.id}
            aria-label={template.name}
            aria-pressed={selected === template.id}
            disabled={disabled}
            onClick={() => onSelect(template.id)}
          >
            <span className="template-preview">
              <img
                src={`${previewBase}/${template.id}.svg`}
                alt=""
                loading="lazy"
                decoding="async"
              />
              {selected === template.id && (
                <span className="template-selected-mark" aria-hidden="true">
                  ✓
                </span>
              )}
            </span>
            <span className="template-card-caption">
              <strong>{template.name}</strong>
              <span>{template.description}</span>
            </span>
          </button>
        ))}
        {templates.length === 0 && (
          <div className="template-empty" role="status">
            <strong>No templates match your search.</strong>
            <span>Try a different name or category.</span>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("All");
              }}
            >
              Show all templates
            </button>
          </div>
        )}
      </div>
      <p className="template-count">
        {templates.length} of {TEMPLATE_CATALOG.length} templates
      </p>
    </section>
  );
}
