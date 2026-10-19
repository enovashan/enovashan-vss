const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const handler = require("../api/cms-images");
const postsHandler = require("../api/cms-posts");
const { MAX_IMAGE_BYTES, isThumbnailUrl, validateWebp } = require("../api/_cms-images");

const url = "https://example.supabase.co";
const imageUrl = `${url}/storage/v1/object/public/article-thumbnails/12345678-1234-4321-9876-123456789abc.webp`;
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function webp(width = 1200, height = 675) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBPVP8X", 8);
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function configure() {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.ADMIN_EMAIL = "admin@example.com";
}

function response() {
  return {
    statusCode: 0, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function composer() {
  const html = fs.readFileSync(path.join(__dirname, "..", "cms", "index.html"), "utf8");
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", innerHTML: "", style: {}, hidden: false,
      removeAttribute(name) { delete this[name]; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    window: { addEventListener() {} },
    localStorage: { getItem() { return ""; } },
    document: { getElementById },
    console, setTimeout,
  });
  vm.runInContext(script, context);
  return { context, elements, getElementById };
}

test("thumbnail URLs accept only this project's generated public WebP paths", () => {
  assert.equal(isThumbnailUrl("", url), true);
  assert.equal(isThumbnailUrl(imageUrl, url), true);
  for (const invalid of [null, 12, "javascript:alert(1)", imageUrl + "?x=1", imageUrl.replace("article-thumbnails/", "article-thumbnails/../"), imageUrl.replace(url, "https://other.example")]) {
    assert.equal(isThumbnailUrl(invalid, url), false);
  }
});

test("WebP headers enforce size, still images, and exact dimensions", () => {
  validateWebp(webp());
  assert.throws(() => validateWebp(webp(2400, 1350)), /1200 by 675/);
  assert.throws(() => validateWebp(Buffer.alloc(MAX_IMAGE_BYTES + 1)), /300 KB/);
  assert.throws(() => validateWebp(Buffer.from("not an image")), /valid WebP/);
  const animated = webp();
  animated[20] = 2;
  assert.throws(() => validateWebp(animated), /still WebP/);
});

test("upload rejects unauthenticated and non-admin callers before touching storage", async () => {
  configure();
  global.fetch = async () => json({ email: "other@example.com" });
  const missing = response();
  await handler({ method: "POST", headers: {}, body: {} }, missing);
  assert.equal(missing.statusCode, 401);
  const denied = response();
  await handler({ method: "POST", headers: { authorization: "Bearer test" }, body: {} }, denied);
  assert.equal(denied.statusCode, 403);
});

test("upload creates a restricted public bucket and writes immutable WebP", async () => {
  configure();
  const calls = [];
  global.fetch = async (target, options) => {
    calls.push({ target, options });
    if (target.endsWith("/auth/v1/user")) return json({ email: "admin@example.com" });
    if (target.endsWith("/bucket/article-thumbnails")) return json({ statusCode: "404", message: "Bucket not found" }, 400);
    if (target.endsWith("/bucket")) return json({});
    return json({});
  };
  const res = response();
  await handler({ method: "POST", headers: { authorization: "Bearer test" }, body: { image: webp().toString("base64") } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(isThumbnailUrl(res.body.url, url), true);
  const bucket = JSON.parse(calls[2].options.body);
  assert.equal(bucket.public, true);
  assert.equal(bucket.file_size_limit, MAX_IMAGE_BYTES);
  assert.deepEqual(bucket.allowed_mime_types, ["image/webp"]);
  assert.equal(calls[3].options.headers["content-type"], "image/webp");
  assert.equal(calls[3].options.body.length, res.body.bytes);
});

test("malformed uploads and storage failures return explicit errors", async () => {
  configure();
  global.fetch = async (target) => target.endsWith("/auth/v1/user")
    ? json({ email: "admin@example.com" })
    : json({ message: "Storage unavailable" }, 500);
  for (const body of ['{', { image: "invalid" }, { image: "A".repeat(MAX_IMAGE_BYTES * 2) }]) {
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer test" }, body }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error);
  }
  const res = response();
  await handler({ method: "POST", headers: { authorization: "Bearer test" }, body: { image: webp().toString("base64") } }, res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /Storage unavailable/);
});

test("existing buckets are reused and private buckets or failed writes are not reported as success", async () => {
  configure();
  for (const mode of ["success", "private", "write-failure"]) {
    let creates = 0;
    global.fetch = async (target) => {
      if (target.endsWith("/auth/v1/user")) return json({ email: "admin@example.com" });
      if (target.endsWith("/bucket/article-thumbnails")) return json({ public: mode !== "private" });
      if (target.endsWith("/bucket")) creates++;
      return mode === "write-failure" ? json({ message: "Quota exceeded" }, 413) : json({});
    };
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer test" }, body: { image: webp().toString("base64") } }, res);
    assert.equal(creates, 0);
    assert.equal(res.statusCode, mode === "success" ? 200 : 500);
    if (mode === "private") assert.match(res.body.error, /must be public/);
    if (mode === "write-failure") assert.match(res.body.error, /Quota exceeded/);
  }
});

test("saving supports thumbnails, explicit removal, and older clients without thumbnail fields", async () => {
  configure();
  let saved;
  global.fetch = async (target, options) => {
    if (target.endsWith("/auth/v1/user")) return json({ email: "admin@example.com" });
    saved = JSON.parse(options.body);
    return json([saved]);
  };
  for (const fields of [
    { thumbnail_url: imageUrl, thumbnail_alt: " A landscape " },
    { thumbnail_url: "", thumbnail_alt: "" },
    {},
  ]) {
    const res = response();
    await postsHandler({ method: "POST", headers: { authorization: "Bearer test" }, body: { slug: "test", title: "Test", ...fields } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.thumbnail_url, fields.thumbnail_url);
    assert.equal(saved.thumbnail_alt, fields.thumbnail_alt?.trim());
    if (!("thumbnail_url" in fields)) assert.equal("thumbnail_url" in saved, false);
  }
  const res = response();
  await postsHandler({ method: "POST", headers: { authorization: "Bearer test" }, body: { slug: "test", title: "Test", thumbnail_url: "https://other.example/x.webp" } }, res);
  assert.equal(res.statusCode, 400);
});

test("CMS preview, removal, exports, RTL and no-image fallbacks stay consistent", () => {
  const { context, getElementById } = composer();
  const post = {
    slug: "test", title: "Test", summary: "Summary", content_html: "<p>Body</p>",
    category: "Ideas", language: "ur", target_page: "stories", published_at: "2026-10-19",
    thumbnail_url: imageUrl, thumbnail_alt: 'A "landscape"',
  };
  context.post = post;
  const html = vm.runInContext("buildFullStaticHtml(post)", context);
  const card = vm.runInContext("buildCardSnippet(post)", context);
  assert.match(html, /class="article-cover"/);
  assert.match(html, /og:image/);
  assert.match(html, /alt="A &quot;landscape&quot;"/);
  assert.match(html, /dir="rtl"/);
  assert.match(card, /loading="lazy"/);
  assert.match(card, /class="article-thumbnail"/);
  context.post = { ...post, thumbnail_url: "" };
  assert.doesNotMatch(vm.runInContext("buildFullStaticHtml(post)", context), /class="article-cover"|og:image/);
  assert.doesNotMatch(vm.runInContext("buildCardSnippet(post)", context), /class="article-thumbnail"/);
  context.url = imageUrl;
  vm.runInContext('setThumbnail(url, "Landscape"); updateLivePreview()', context);
  assert.equal(getElementById("previewCover").src, imageUrl);
  assert.equal(getElementById("previewCover").alt, "Landscape");
  vm.runInContext("removeThumbnail()", context);
  assert.equal(getElementById("thumbnailDetails").hidden, true);
  assert.equal(getElementById("previewCover").style.display, "none");
  assert.equal(getElementById("previewCover").src, undefined);
});

test("thumbnail resizing preserves every edge of wide and portrait images", async () => {
  for (const [width, height, expected] of [
    [1600, 900, [0, 0, 1200, 675]],
    [1800, 900, [0, 37.5, 1200, 600]],
    [900, 1800, [431.25, 0, 337.5, 675]],
  ]) {
    const { context } = composer();
    let drawn;
    let background;
    let closed = false;
    const bitmap = { width, height, close() { closed = true; } };
    context.createImageBitmap = async () => bitmap;
    context.document.createElement = () => ({
      getContext() {
        return {
          fillRect(...args) { background = args; },
          drawImage(image, ...args) {
            assert.equal(image, bitmap);
            drawn = args;
          },
        };
      },
      toBlob(callback, type) { callback({ size: 1000, type }); },
    });
    const result = await vm.runInContext('compressThumbnail({type: "image/png", size: 1000})', context);
    assert.deepEqual(background, [0, 0, 1200, 675]);
    assert.deepEqual(drawn, expected);
    assert.equal(closed, true);
    assert.equal(result.type, "image/webp");
    assert.ok(result.size <= MAX_IMAGE_BYTES);
  }
});

test("server publishing renders images on articles and homepage/directory cards", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "api", "_github-publish.js"), "utf8");
  const context = vm.createContext({ module: { exports: {} }, process, Buffer, console });
  vm.runInContext(source, context);
  context.post = {
    slug: "test", title: "Test", summary: "Summary", content_html: "<p>Body</p>",
    language: "ar", target_page: "stories", thumbnail_url: imageUrl, thumbnail_alt: "Landscape",
  };
  assert.match(vm.runInContext("buildFullStaticHtml(post)", context), /class="article-cover"/);
  assert.match(vm.runInContext("buildCardSnippet(post)", context), /class="article-thumbnail"/);
  assert.match(vm.runInContext("buildCardSnippet(post, {home: true})", context), /class="article-thumbnail"/);
  context.post.thumbnail_url = "";
  assert.doesNotMatch(vm.runInContext("buildFullStaticHtml(post)", context), /class="article-cover"/);
  assert.doesNotMatch(vm.runInContext("buildCardSnippet(post)", context), /class="article-thumbnail"/);
});
