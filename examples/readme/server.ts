// The apps behind the README video: a members dashboard, a terminal with an agent in it, and a player for the result.
// Run it with `bun examples/readme/server.ts`. VIDEO is the file /player plays (WebM, since Chromium can't play H.264),
// WALLPAPER the image behind the terminal and player windows.
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 4322);
const VIDEO = process.env.VIDEO ?? join(import.meta.dir, "member-invite.webm");
const WALLPAPER = process.env.WALLPAPER ?? join(import.meta.dir, "../assets/background.jpg");

const page = (name: string) => new Response(Bun.file(join(import.meta.dir, name)));

Bun.serve({
  port: PORT,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/" || path === "/settings/members") return page("dashboard.html");
    if (path === "/terminal") return page("terminal.html");
    if (path === "/player") return page("player.html");
    if (path === "/video") return new Response(Bun.file(VIDEO));
    if (path === "/wallpaper") return new Response(Bun.file(WALLPAPER));
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Dashboard on http://localhost:${PORT}/settings/members, terminal on http://localhost:${PORT}/terminal`);
