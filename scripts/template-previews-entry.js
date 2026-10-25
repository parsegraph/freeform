import fs from "node:fs";
import path from "node:path";
import { createExample, loadExample } from "../src/examples";
import { graphNodes } from "../src/graphDocument";
import { TEMPLATE_CATALOG } from "../src/templateCatalog";
import { renderTemplatePreview } from "../src/templatePreview";

export async function generateTemplatePreviews(root, check) {
  const output = path.join(root, "public/template-previews");
  if (!check) fs.mkdirSync(output, { recursive: true });
  const manifest = {};
  const stale = [];
  const write = (filename, content) => {
    const target = path.join(output, filename);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content)
        stale.push(filename);
    } else fs.writeFileSync(target, content);
  };
  for (const template of TEMPLATE_CATALOG) {
    const example = createExample(template.id, {
      seed: 42,
      rounds: 5,
      vertical: false,
      ...(template.id === "grid" ? { size: 12 } : {}),
      ...(template.id === "proportion_v1" ? { columns: 3 } : {}),
    });
    const loaded = await loadExample(example);
    const options = {
      width: 480,
      height: 300,
      ...(template.category === "Planning" ? { cropHeight: 220 } : {}),
    };
    const svg = renderTemplatePreview(loaded, options) + "\n";
    write(`${template.id}.svg`, svg);
    manifest[template.id] = {
      example,
      nodes: graphNodes(loaded.graph).length,
      ...options,
    };
    console.log(
      `${template.name}: ${manifest[template.id].nodes} nodes, ${(
        Buffer.byteLength(svg) / 1024
      ).toFixed(1)} KiB`
    );
  }
  write("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  if (stale.length)
    throw new Error(`Regenerate template previews: ${stale.join(", ")}`);
  console.log(
    check
      ? "All template previews are current."
      : "Template previews generated."
  );
}
