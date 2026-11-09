// Builds the release binaries into dist/. Run `bun install --os=darwin --cpu='*'` first,
// so the canvas library's native module is there for every target.
import { $ } from "bun";

const TARGETS = ["darwin-arm64", "darwin-x64"];

await $`rm -rf dist`;
for (const target of TARGETS) {
  const dir = `dist/${target}`;
  // chromium-bidi and electron are only needed for browsers showem doesn't use.
  await $`bun build --compile --target=bun-${target} src/cli.ts --external 'chromium-bidi/*' --external electron --outfile ${dir}/showem`;
  await $`tar -czf dist/showem-${target}.tar.gz -C ${dir} showem`;
}
await $`shasum -a 256 showem-*.tar.gz > checksums.txt`.cwd("dist");
