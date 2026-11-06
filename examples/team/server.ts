// A small team app for the multi-screen demo: an admin page and a phone app that share live state.
// Run it with `bun examples/team/server.ts`. Opening /admin?reset starts from the seed data again.
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 4321);
const ORIGIN = `http://localhost:${PORT}`;

interface Member { id: string; name: string; role: "Admin" | "Member"; joinedAt: number }
interface Post { id: string; author: string; text: string; at: number }

let members: Member[] = [];
let posts: Post[] = [];
let invites = new Set<string>();

function reset() {
  const day = 24 * 60 * 60 * 1000;
  members = [
    { id: "m1", name: "Alex Kim", role: "Admin", joinedAt: Date.now() - 300 * day },
    { id: "m2", name: "Priya Shah", role: "Member", joinedAt: Date.now() - 120 * day },
    { id: "m3", name: "Marcus Lee", role: "Member", joinedAt: Date.now() - 40 * day },
  ];
  posts = [{ id: "p1", author: "Alex Kim", text: "Q3 planning doc is up. Comments welcome by Friday.", at: Date.now() - 2 * day }];
  invites = new Set();
}
reset();

const listeners = new Set<ReadableStreamDefaultController<string>>();
const snapshot = () => JSON.stringify({ members, posts });
function broadcast() {
  for (const listener of listeners) listener.enqueue(`data: ${snapshot()}\n\n`);
}

const page = (name: string) => new Response(Bun.file(join(import.meta.dir, name)));
const id = () => crypto.randomUUID().slice(0, 8);

Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/admin") {
      if (url.searchParams.has("reset")) reset();
      return page("admin.html");
    }
    if (path === "/" || path === "/feed" || path.startsWith("/invite/")) return page("app.html");
    if (path === "/api/events") {
      let self: ReadableStreamDefaultController<string>;
      const stream = new ReadableStream<string>({
        start(controller) {
          self = controller;
          listeners.add(controller);
          controller.enqueue(`data: ${snapshot()}\n\n`);
        },
        cancel() {
          listeners.delete(self);
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    if (path === "/api/invites" && req.method === "POST") {
      const token = id();
      invites.add(token);
      return Response.json({ url: `${ORIGIN}/invite/${token}` });
    }
    if (path === "/api/join" && req.method === "POST") {
      const { token, name } = await req.json();
      if (!invites.has(token)) return new Response("This invite is no longer valid", { status: 410 });
      invites.delete(token);
      const member: Member = { id: id(), name: String(name).trim() || "New member", role: "Member", joinedAt: Date.now() };
      members.push(member);
      broadcast();
      return Response.json(member, { headers: { "Set-Cookie": `member=${member.id}; Path=/; SameSite=Lax` } });
    }
    if (path === "/api/posts" && req.method === "POST") {
      const { text } = await req.json();
      posts.unshift({ id: id(), author: "Alex Kim", text: String(text).trim(), at: Date.now() });
      broadcast();
      return Response.json({ ok: true });
    }
    if (path === "/api/me") {
      const memberId = req.headers.get("cookie")?.match(/member=(\w+)/)?.[1];
      return Response.json(members.find((m) => m.id === memberId) ?? null);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Team app on ${ORIGIN}/admin and ${ORIGIN}/`);
