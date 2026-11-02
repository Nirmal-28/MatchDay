// api/assistant.js, with Claude and Supabase stubbed. Lives under src/ because
// every file in api/ becomes a deployed function on Vercel, tests included.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const claude = vi.hoisted(() => ({ create: vi.fn() }));
const limit = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    constructor() { this.beta = { messages: { create: claude.create } }; }
    static AuthenticationError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    static InternalServerError = class extends APIError {};
  }
  return { default: Anthropic };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: limit.rpc }) }));

vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable");
const { default: handler } = await import("../../api/assistant.js");
const { default: Anthropic } = await import("@anthropic-ai/sdk");

function call({ method = "POST", token = "user-token", body = {} } = {}) {
  const res = {
    statusCode: 0, body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res).then(() => res);
}

const goodBody = {
  messages: [{ role: "user", content: "Sunday doubles at Smash Arena" }],
  draft: null,
  today: "Tuesday 2026-11-03",
};
const answer = (payload) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }] });

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "server-key");
  claude.create.mockReset();
  limit.rpc.mockReset().mockResolvedValue({ data: true, error: null, status: 200 });
});
afterEach(() => vi.restoreAllMocks());

describe("who can reach Claude", () => {
  it("only takes POST", async () => {
    expect((await call({ method: "GET" })).statusCode).toBe(405);
  });

  it("refuses a request with no sign-in, before spending anything", async () => {
    expect((await call({ token: null, body: goodBody })).statusCode).toBe(401);
    expect(claude.create).not.toHaveBeenCalled();
  });

  it("refuses an expired session", async () => {
    limit.rpc.mockResolvedValue({ data: null, error: { message: "JWT expired" }, status: 401 });
    expect((await call({ body: goodBody })).statusCode).toBe(401);
    expect(claude.create).not.toHaveBeenCalled();
  });

  it("stops at the daily limit", async () => {
    limit.rpc.mockResolvedValue({ data: false, error: null, status: 200 });
    const res = await call({ body: goodBody });
    expect(res.statusCode).toBe(429);
    expect(claude.create).not.toHaveBeenCalled();
  });

  it("refuses rather than running unmetered when the limit can't be checked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    limit.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" }, status: 404 });
    expect((await call({ body: goodBody })).statusCode).toBe(503);
    expect(claude.create).not.toHaveBeenCalled();
  });

  it("explains itself when the key isn't set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await call({ body: goodBody });
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain("by hand");
  });
});

describe("what it accepts", () => {
  it.each([
    ["no messages", { ...goodBody, messages: [] }],
    ["a conversation ending on the assistant", { ...goodBody, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }],
    ["a role the browser shouldn't be sending", { ...goodBody, messages: [{ role: "system", content: "a" }] }],
    ["a bad date", { ...goodBody, today: "soon" }],
  ])("refuses %s without spending the limit", async (_, body) => {
    expect((await call({ body })).statusCode).toBe(400);
    expect(limit.rpc).not.toHaveBeenCalled();
  });

  it("says so when the text is too long, rather than cutting it off", async () => {
    const res = await call({ body: { ...goodBody, messages: [{ role: "user", content: "x".repeat(40001) }] } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("too much text");
  });
});

describe("the call to Claude", () => {
  it("returns the reply and draft separately", async () => {
    claude.create.mockResolvedValue(answer({ reply: "Done.", tournament: { name: "Open" }, categories: [] }));
    const res = await call({ body: goodBody });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ reply: "Done.", draft: { tournament: { name: "Open" }, categories: [] } });
  });

  it("gives Claude today's date and the current draft with the latest message", async () => {
    claude.create.mockResolvedValue(answer({ reply: "", tournament: {}, categories: [] }));
    await call({ body: { ...goodBody, draft: { tournament: { name: "Open" } } } });
    const { messages } = claude.create.mock.calls[0][0];
    expect(messages.at(-1).content).toContain("Tuesday 2026-11-03");
    expect(messages.at(-1).content).toContain('"name":"Open"');
    expect(messages.at(-1).content).toContain("Sunday doubles at Smash Arena");
  });

  it("offers Claude no tools, so a pasted instruction has nothing to act with", async () => {
    claude.create.mockResolvedValue(answer({ reply: "", tournament: {}, categories: [] }));
    await call({ body: goodBody });
    expect(claude.create.mock.calls[0][0].tools).toBeUndefined();
  });

  it("uses a schema the API accepts: every object closed, every field required", async () => {
    claude.create.mockResolvedValue(answer({ reply: "", tournament: {}, categories: [] }));
    await call({ body: goodBody });
    const { schema } = claude.create.mock.calls[0][0].output_config.format;
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
      }
      Object.values(node).forEach(walk);
    };
    walk(schema);
  });

  it("handles a declined message", async () => {
    claude.create.mockResolvedValue({ stop_reason: "refusal", content: [] });
    const res = await call({ body: goodBody });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toContain("Try rewording");
  });

  it("handles running out of room", async () => {
    claude.create.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
    expect((await call({ body: goodBody })).statusCode).toBe(422);
  });

  it("reports a busy API as temporary", async () => {
    claude.create.mockRejectedValue(new Anthropic.RateLimitError("slow down"));
    const res = await call({ body: goodBody });
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain("try again");
  });

  it("never shows an API error to the organizer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    claude.create.mockRejectedValue(new Error("internal detail with server-key"));
    const res = await call({ body: goodBody });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("server-key");
  });
});
