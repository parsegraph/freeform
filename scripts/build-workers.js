const path = require("path");
const webpack = require("webpack");

// Use the app's installed webpack, so a root install also builds its workers.
const root = path.resolve(__dirname, "..");
const compiler = webpack({
  mode: "production",
  target: "webworker",
  context: root,
  entry: {
    occluder: "./occluder/src/index.js",
    textrenderer: "./textrenderer/src/index.js",
  },
  output: { path: path.join(root, "public"), filename: "[name].js" },
});

compiler.run((error, stats) => {
  compiler.close((closeError) => {
    if (stats) {
      console.log(
        stats.toString({
          all: false,
          assets: true,
          errors: true,
          warnings: true,
        })
      );
      if (stats.hasErrors()) process.exitCode = 1;
    }
    for (const failure of [error, closeError]) {
      if (failure) {
        console.error(failure);
        process.exitCode = 1;
      }
    }
  });
});
