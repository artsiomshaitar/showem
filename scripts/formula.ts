// Prints the Homebrew formula for a release, from dist/checksums.txt: bun scripts/formula.ts 0.1.0
const version = Bun.argv[2];
if (!version) throw new Error("Usage: bun scripts/formula.ts <version>");

const sums = Object.fromEntries(
  (await Bun.file("dist/checksums.txt").text()).trim().split("\n").map((line) => line.split(/\s+/).reverse()),
);
const asset = (target: string) => {
  const name = `showem-${target}.tar.gz`;
  if (!sums[name]) throw new Error(`No checksum for ${name}`);
  return `url "https://github.com/artsiomshaitar/showem/releases/download/v${version}/${name}"\n    sha256 "${sums[name]}"`;
};

console.log(`class Showem < Formula
  desc "Screen studio for your agent"
  homepage "https://github.com/artsiomshaitar/showem"
  version "${version}"
  license "MIT"

  depends_on :macos

  on_arm do
    ${asset("darwin-arm64")}
  end
  on_intel do
    ${asset("darwin-x64")}
  end

  def install
    bin.install "showem"
  end

  def caveats
    "showem downloads Chromium and ffmpeg into ~/.showem the first time it needs them. Run \`showem setup\` to do it now."
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/showem --version")
  end
end`);
