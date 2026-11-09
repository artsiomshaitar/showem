// Builds the release binaries into dist/. Run `bun install --os=darwin --cpu='*'` first,
// so the canvas library's native module is there for every target.
import { $, type BunPlugin } from "bun";

const TARGETS = ["darwin-arm64", "darwin-x64"] as const;

// playwright-core loads its package.json and browsers.json with a path built from __dirname, which the
// bundler can't follow, so the binary would look for them in this machine's node_modules. Point those
// requires at the files directly so they get bundled.
const inlinePlaywrightJson: BunPlugin = {
  name: "inline playwright-core json",
  setup(build) {
    build.onLoad({ filter: /playwright-core\/lib\/coreBundle\.js$/ }, async ({ path }) => {
      const pattern = /require\(import_path\d*\.default\.join\(packageRoot, "(package|browsers)\.json"\)\)/g;
      const source = await Bun.file(path).text();
      const found = source.match(pattern)?.length ?? 0;
      if (found !== 2) throw new Error(`Expected 2 JSON requires in ${path}, found ${found}. Update scripts/build.ts.`);
      return { contents: source.replace(pattern, 'require("../$1.json")'), loader: "js" };
    });
  },
};

await $`rm -rf dist`;
for (const target of TARGETS) {
  const dir = `dist/${target}`;
  const result = await Bun.build({
    entrypoints: ["src/cli.ts"],
    compile: { target: `bun-${target}`, outfile: `${dir}/showem` },
    // chromium-bidi and electron are only needed for browsers showem doesn't use.
    external: ["chromium-bidi/*", "electron"],
    plugins: [inlinePlaywrightJson],
  });
  if (!result.success) throw new AggregateError(result.logs, `Build for ${target} failed`);
  await $`tar -czf dist/showem-${target}.tar.gz -C ${dir} showem`;
}
await $`shasum -a 256 showem-*.tar.gz > checksums.txt`.cwd("dist");
