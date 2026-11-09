import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { concatList, concatVideos, startEncoder } from "../src/ffmpeg.ts";
import { probeVideo } from "./fixtures.ts";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

test("the concat list escapes single quotes", () => {
  expect(concatList(["/a/b.mp4", "/John's/c.mp4"])).toBe("file '/a/b.mp4'\nfile '/John'\\''s/c.mp4'\n");
});

test("encodes frames and joins parts, even with a quote in the path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "showem John's "));
  dirs.push(dir);
  const size = { width: 64, height: 32 };
  const parts = [join(dir, "0.mp4"), join(dir, "1.mp4")];
  for (const [k, part] of parts.entries()) {
    const encoder = startEncoder(part, size, 10);
    for (let i = 0; i < 3; i++) await encoder.write(new Uint8Array(size.width * size.height * 4).fill(k * 200));
    await encoder.close();
  }
  const out = join(dir, "out.mp4");
  await concatVideos(parts, join(dir, "list.txt"), out);
  expect(probeVideo(out)).toBe(`${size.width},${size.height},6`);
});
