#!/usr/bin/env node
"use strict";

// Generate static gallery artwork without requiring Chrome, a dev server, or
// the sibling Parsegraph checkout. The normal app never runs this work.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webpack = require("webpack");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check")) {
  console.error("Usage: yarn templates:previews [--check]");
  process.exit(1);
}

async function main() {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "freeform-previews-")
  );
  const dom = new JSDOM();
  try {
    const compiler = webpack({
      mode: "none",
      target: "node",
      context: root,
      entry: "./scripts/template-previews-entry.js",
      output: {
        path: temporary,
        filename: "previews.cjs",
        library: { type: "commonjs2" },
      },
      plugins: [
        new webpack.DefinePlugin({
          "process.env.PUBLIC_URL": JSON.stringify(""),
        }),
      ],
    });
    await new Promise((resolve, reject) => {
      compiler.run((error, stats) => {
        compiler.close((closeError) => {
          if (error || closeError) return reject(error || closeError);
          if (stats.hasErrors())
            return reject(
              new Error(
                stats.toString({
                  all: false,
                  errors: true,
                  warnings: true,
                })
              )
            );
          resolve();
        });
      });
    });
    // Only the XML importer needs a DOM. Example source files come from the
    // repository, never the network. No document scripts are executed.
    global.DOMParser = dom.window.DOMParser;
    global.fetch = async (url) => {
      const filename = {
        "/examples/sample.json": "sample.json",
        "/examples/sample.lisp": "sample.lisp",
      }[url];
      if (!filename) throw new Error(`Unexpected example URL: ${url}`);
      return {
        ok: true,
        text: async () =>
          fs.readFileSync(path.join(root, "public/examples", filename), "utf8"),
      };
    };
    await require(path.join(
      temporary,
      "previews.cjs"
    )).generateTemplatePreviews(root, check);
  } finally {
    dom.window.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
