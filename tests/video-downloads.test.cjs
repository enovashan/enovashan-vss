const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function interfaceFixture(hash = "", signedIn = false) {
  const elements = new Map();
  const callbacks = new Map();
  const requests = [];
  const token = "a".repeat(64);
  const jobs = [{
    id: "12345678-1234-1234-1234-123456789abc",
    url: "https://www.instagram.com/reel/one/", folder: "/Videos",
    status: "Failed", error: '<script>alert("x")</script>',
  }];
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", innerHTML: "", hidden: true, checked: false, options: [],
      setAttribute() {},
      replaceChildren() { this.options = []; },
      append(option) { this.options.push(option); },
      addEventListener(event, callback) { callbacks.set(`${id}:${event}`, callback); },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: get,
      createElement() { return {}; },
      addEventListener(event, callback) {
        if (event === "DOMContentLoaded") callback();
        else callbacks.set(`document:${event}`, callback);
      },
    },
    URLSearchParams,
    location: { hash, pathname: "/cms", search: "" },
    history: { replaceState(state, title, url) { context.location.replacedWith = url; context.location.hash = ""; } },
    currentUser: signedIn ? { email: "admin@example.com" } : null,
    switchMainView(view) { get("currentView").textContent = view; },
    AbortSignal, console, setTimeout() { return 1; }, clearTimeout() {}, confirm() { return true; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/status")) return new Response(JSON.stringify({ version: 1, jobs, folder: "/Videos" }));
      if (url.endsWith("/check")) return new Response(JSON.stringify({ checks: [{ name: "yt-dlp", ok: true }] }));
      if (url.endsWith("/folders")) return new Response(JSON.stringify({ folders: ["/", "/Videos"] }));
      return new Response(JSON.stringify({ accepted: true }));
    },
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "cms", "video-downloads.js"), "utf8"), context);
  return { get, callbacks, context, requests, token, jobs };
}

test("helper pairing is memory-only, requests go directly to loopback and tool status is explicit", async () => {
  const { get, callbacks, requests, token } = interfaceFixture();
  get("videoPairingCode").value = token;
  await callbacks.get("videoConnectBtn:click")();
  assert.equal(get("videoPairingCode").value, "");
  assert.equal(get("videoConnectedControls").hidden, false);
  assert.match(get("videoToolChecks").textContent, /Ready/);
  assert.ok(requests.every(request => request.url.startsWith("http://127.0.0.1:47831/")));
  assert.ok(requests.every(request => request.options.headers.Authorization === `Bearer ${token}`));
  assert.ok(requests.every(request => request.options.credentials === "omit"));
});

test("queue errors are escaped, folder choices are loaded and destination saved locally", async () => {
  const { get, callbacks, requests, token } = interfaceFixture();
  get("videoPairingCode").value = token;
  await callbacks.get("videoConnectBtn:click")();
  assert.doesNotMatch(get("videoJobs").innerHTML, /<script>/);
  assert.match(get("videoJobs").innerHTML, /&lt;script&gt;/);
  assert.match(get("videoJobs").innerHTML, /Retry/);
  await callbacks.get("videoBrowseBtn:click")();
  assert.deepEqual(get("videoFolderChoices").options.map(option => option.value), ["/", "/Videos"]);
  get("videoFolderChoices").value = "/Videos";
  await callbacks.get("videoSaveFolderBtn:click")();
  assert.equal(JSON.parse(requests.find(request => request.url.endsWith("/folder")).options.body).folder, "/Videos");
});

test("submitting needs permission and sends one trimmed link per line", async () => {
  const { get, callbacks, requests, token } = interfaceFixture();
  get("videoPairingCode").value = token;
  await callbacks.get("videoConnectBtn:click")();
  get("videoLinks").value = " https://www.instagram.com/reel/one/ \n\nhttps://www.facebook.com/reel/123";
  await callbacks.get("videoSubmitBtn:click")();
  assert.match(get("videoActionStatus").textContent, /permission/);
  assert.equal(requests.some(request => request.url.endsWith("/jobs")), false);
  get("videoPermission").checked = true;
  await callbacks.get("videoSubmitBtn:click")();
  const body = JSON.parse(requests.find(request => request.url.endsWith("/jobs")).options.body);
  assert.deepEqual(body.links, ["https://www.instagram.com/reel/one/", "https://www.facebook.com/reel/123"]);
  assert.equal(body.permission, true);
  assert.equal(get("videoLinks").value, "");
});

test("disconnect clears pairing, queue and folder information; invalid pairing does not connect", async () => {
  const { get, callbacks, context, requests, token } = interfaceFixture();
  get("videoPairingCode").value = "wrong";
  await callbacks.get("videoConnectBtn:click")();
  assert.equal(requests.length, 0);
  assert.match(get("videoHelperStatus").textContent, /64-character/);
  get("videoPairingCode").value = token;
  await callbacks.get("videoConnectBtn:click")();
  context.disconnectVideoHelper();
  assert.equal(get("videoConnectedControls").hidden, true);
  assert.equal(get("videoJobs").innerHTML, "");
  assert.equal(get("videoFolderChoices").options.length, 0);
});

test("connection failures are visible rather than presenting a connected state", async () => {
  const { get, callbacks, context, token } = interfaceFixture();
  context.fetch = async () => { throw new Error("Blocked by browser"); };
  get("videoPairingCode").value = token;
  await callbacks.get("videoConnectBtn:click")();
  assert.match(get("videoHelperStatus").textContent, /local-network access/);
  assert.equal(get("videoConnectedControls").hidden, true);
});

test("Connect CMS fragment is removed immediately and pairs only after CMS authentication", async () => {
  const token = "b".repeat(64);
  const { get, context, requests, callbacks } = interfaceFixture(`#video-helper=${token}`);
  assert.equal(context.location.replacedWith, "/cms");
  assert.equal(context.location.hash, "");
  assert.equal(requests.length, 0);
  await callbacks.get("document:cms:authenticated")();
  assert.equal(get("currentView").textContent, "video-downloads");
  assert.equal(get("videoConnectedControls").hidden, false);
  assert.ok(requests.every(request => request.options.headers.Authorization === `Bearer ${token}`));
  const count = requests.length;
  await callbacks.get("document:cms:authenticated")();
  assert.equal(requests.length, count, "pairing link must be consumed once");
});

test("signed-in CMS automatically consumes the helper link without a login event", async () => {
  const { get, requests } = interfaceFixture(`#video-helper=${"c".repeat(64)}`, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get("currentView").textContent, "video-downloads");
  assert.equal(get("videoConnectedControls").hidden, false);
  assert.ok(requests.length > 0);
});

test("invalid helper fragments are stripped and fail explicitly without sending a request", async () => {
  const { get, context, requests, callbacks } = interfaceFixture("#video-helper=invalid");
  await callbacks.get("document:cms:authenticated")();
  assert.equal(context.location.hash, "");
  assert.equal(requests.length, 0);
  assert.match(get("videoHelperStatus").textContent, /64-character/);
});
