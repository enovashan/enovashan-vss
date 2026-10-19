const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const handler = require("../api/_cms-subscribers");
const postsHandler = require("../api/cms-posts");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function setup() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.ADMIN_EMAIL = "admin@example.com";
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function request(query = {}) {
  return { method: "GET", headers: { authorization: "Bearer test" }, query };
}

test("subscriber data is admin-only and never cached", async () => {
  setup();
  let calls = 0;
  global.fetch = async () => { calls++; return json({ email: "other@example.com" }); };
  const missing = response();
  await handler({ method: "GET", headers: {} }, missing);
  assert.equal(missing.statusCode, 401);
  assert.equal(calls, 0);
  assert.equal(missing.headers["cache-control"], "no-store");
  const denied = response();
  await handler(request(), denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(calls, 1);
  const method = response();
  await handler({ method: "POST" }, method);
  assert.equal(method.statusCode, 405);
});

test("list is newest first, paginated, active-only and excludes private tokens", async () => {
  setup();
  let query;
  const rows = [{ email: "new@example.com", created_at: "2026-10-19T08:00:00Z" }];
  global.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return json({ email: "admin@example.com" });
    query = new URL(url).searchParams;
    assert.equal(options.headers.Prefer, "count=exact");
    return json(rows, 200, { "content-range": "50-50/51" });
  };
  const res = response();
  await handler(request({ page: "2" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 51);
  assert.equal(res.body.pageSize, 50);
  assert.equal(query.get("select"), "email,created_at");
  assert.equal(query.get("order"), "created_at.desc,id.desc");
  assert.equal(query.get("confirmed"), "eq.true");
  assert.equal(query.get("unsubscribed_at"), "is.null");
  assert.equal(query.get("offset"), "50");
  assert.equal(query.get("limit"), "50");
  assert.deepEqual(res.body.subscribers, rows);
});

test("header count uses exact total rather than the page size", async () => {
  setup();
  global.fetch = async (url) => {
    if (url.endsWith("/auth/v1/user")) return json({ email: "admin@example.com" });
    assert.equal(new URL(url).searchParams.get("limit"), "0");
    return json([], 200, { "content-range": "*/1234" });
  };
  const res = response();
  await handler(request({ summary: "true" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 1234);
  assert.deepEqual(res.body.subscribers, []);
});

test("existing CMS endpoint routes subscriber requests to the admin-only handler", async () => {
  setup();
  global.fetch = async (url) => {
    if (url.endsWith("/auth/v1/user")) return json({ email: "admin@example.com" });
    assert.equal(new URL(url).pathname, "/rest/v1/subscribers");
    return json([], 200, { "content-range": "*/0" });
  };
  const res = response();
  await postsHandler(request({ resource: "subscribers", summary: "true" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 0);
  const unauthorized = response();
  await postsHandler({ method: "GET", headers: {}, query: { resource: "subscribers" } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
});

test("empty subscriber list and invalid paging are handled", async () => {
  setup();
  global.fetch = async (url) => url.endsWith("/auth/v1/user")
    ? json({ email: "admin@example.com" })
    : json([], 200, { "content-range": "*/0" });
  const empty = response();
  await handler(request(), empty);
  assert.equal(empty.body.total, 0);
  for (const page of ["0", "-1", "NaN", "1.5", "9007199254740991"]) {
    const res = response();
    await handler(request({ page }), res);
    assert.equal(res.statusCode, 400);
  }
});

test("storage and count failures cannot become a false zero count", async () => {
  setup();
  for (const result of [json({}, 503), json([], 200), json([], 200, { "content-range": "*/unknown" })]) {
    global.fetch = async (url) => url.endsWith("/auth/v1/user")
      ? json({ email: "admin@example.com" }) : result;
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 502);
    assert.ok(res.body.error);
    assert.equal(res.body.total, undefined);
  }
});

function composer(fetch) {
  const html = fs.readFileSync(path.join(__dirname, "..", "cms", "index.html"), "utf8");
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", innerHTML: "", style: {}, disabled: false,
      classList: { add() {}, remove() {} },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    window: { addEventListener() {} },
    localStorage: { getItem() { return "test"; } },
    document: { getElementById: get },
    fetch, console, setTimeout() {},
  });
  vm.runInContext(script, context);
  return { context, get };
}

test("CMS header count, list dates, escaping and pagination", async () => {
  const { context, get } = composer(async () => json({
    total: 51, pageSize: 50,
    subscribers: [{ email: "<admin>@example.com", created_at: "2026-10-19T08:00:00Z" }],
  }));
  await vm.runInContext("loadSubscriberCount()", context);
  assert.equal(get("subscriberCount").textContent, "51");
  await vm.runInContext("loadSubscribers(1)", context);
  assert.match(get("subscribersList").innerHTML, /&lt;admin&gt;@example.com/);
  assert.match(get("subscribersList").innerHTML, /datetime="2026-10-19T08:00:00Z"/);
  assert.equal(get("subscribersPreviousBtn").disabled, true);
  assert.equal(get("subscribersNextBtn").disabled, false);
  await vm.runInContext("loadSubscribers(2)", context);
  assert.equal(get("subscribersPreviousBtn").disabled, false);
  assert.equal(get("subscribersNextBtn").disabled, true);
  assert.equal(get("subscribersPageLabel").textContent, "Page 2 of 2");
});

test("CMS displays empty states, explicit errors, and recovers pages after count changes", async () => {
  const { context, get } = composer(async () => json({ total: 0, subscribers: [], pageSize: 50 }));
  await vm.runInContext("loadSubscribers(2)", context);
  assert.equal(get("subscribersStatus").textContent, "No active subscribers yet.");
  assert.equal(get("subscribersPageLabel").textContent, "Page 1 of 1");
  context.fetch = async () => json({ error: "Storage unavailable" }, 502);
  await vm.runInContext("loadSubscriberCount()", context);
  assert.equal(get("subscriberCount").textContent, "Unavailable");
  await vm.runInContext("loadSubscribers()", context);
  assert.match(get("subscribersStatus").textContent, /Storage unavailable/);
  assert.equal(get("refreshSubscribersBtn").disabled, false);
  assert.equal(get("subscribersList").innerHTML, "");
});
