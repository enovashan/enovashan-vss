const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { TransferQueue, validateLink, validateFolder, createServer, pairingUrl, PORT } = require("../local-helper/video-helper.cjs");

const temporary = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

test("Connect CMS link carries the temporary pairing secret only in the URL fragment", () => {
  const token = "a".repeat(64);
  const url = new URL(pairingUrl(token));
  assert.equal(url.origin, "https://www.enovashan.com");
  assert.equal(url.pathname, "/cms");
  assert.equal(url.search, "");
  assert.equal(url.hash, `#video-helper=${token}`);
  assert.throws(() => pairingUrl("invalid"));
});

async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enovashan-helper-test-"));
  temporary.push(directory);
  const calls = [];
  const remote = new Set();
  const run = async (file, args) => {
    const name = path.basename(file);
    const command = name === "MegaClient" ? args[0] : name.replace(/^mega-/, "");
    const parameters = name === "MegaClient" ? args.slice(1) : args;
    calls.push({ name, command, args, parameters });
    if (name === "yt-dlp" && !args.includes("--version")) {
      const output = path.join(args[args.indexOf("-P") + 1], args[args.indexOf("-o") + 1].replace("%(ext)s", "mp4"));
      await fs.writeFile(output, "simulated video");
      if (options.downloadFailure) throw new Error("Video is unavailable.");
    }
    if (command === "find") return "/\n/Enovashan Reels";
    if (command === "whoami" && options.loginFailure) throw new Error("Not logged in.");
    if (command === "put") {
      if (options.uploadFailure) throw new Error("MEGA quota exceeded.");
      remote.add(parameters[1] + path.basename(parameters[0]));
    }
    if (command === "ls" && !remote.has(parameters[0])) throw new Error("Remote file missing.");
    return "success";
  };
  const queue = new TransferQueue(directory, run, name => name);
  await queue.init();
  return { queue, calls, remote, options, directory, run };
}

async function idle(queue) {
  for (let attempt = 0; attempt < 300 && queue.running; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(queue.running, false, "queue did not finish");
  assert.equal(queue.fatalError, "");
}

test("only supported HTTPS Reel URLs are accepted and tracking is removed", () => {
  assert.equal(validateLink("https://www.instagram.com/reel/Ab_c-12/?igsh=tracking"), "https://www.instagram.com/reel/Ab_c-12/");
  assert.equal(validateLink("https://m.facebook.com/reel/123?mibextid=abc"), "https://m.facebook.com/reel/123");
  assert.equal(validateLink("https://www.facebook.com/share/r/Abc123/"), "https://www.facebook.com/share/r/Abc123/");
  for (const link of [
    "http://instagram.com/reel/abc", "https://evil.example/reel/abc",
    "https://instagram.com.evil.example/reel/abc", "https://instagram.com/profile/",
    "https://user:pass@instagram.com/reel/abc", "file:///C:/video.mp4",
    "https://127.0.0.1/reel/1", "https://facebook.com/reel/1/../../x",
    "https://instagram.com:444/reel/abc", "--exec calc.exe",
  ]) assert.throws(() => validateLink(link));
});

test("MEGA destinations cannot be options, relative paths or wildcards", () => {
  assert.equal(validateFolder("/Enovashan Reels/"), "/Enovashan Reels");
  assert.equal(validateFolder("/"), "/");
  for (const folder of ["--help", "../videos", "/a/../b", "/a/*", "/a\nb", "/a\\b", null]) {
    assert.throws(() => validateFolder(folder));
  }
});

test("sequential transfers upload, verify, then clean, and persist their destination", async () => {
  const { queue, calls, remote, directory } = await fixture();
  await queue.setFolder("/Enovashan Reels");
  await queue.add(["https://www.instagram.com/reel/one/", "https://www.facebook.com/reel/123"]);
  await idle(queue);
  assert.deepEqual(queue.state.jobs.map(job => job.status), ["Ok", "Ok"]);
  assert.equal(remote.size, 2);
  const transfers = calls.filter(call => (call.name === "yt-dlp" && !call.args.includes("--version")) || ["put", "ls"].includes(call.command));
  assert.deepEqual(transfers.map(call => call.name === "yt-dlp" ? "download" : call.command), ["download", "put", "ls", "download", "put", "ls"]);
  const downloadArgs = transfers[0].args;
  assert.ok(downloadArgs.includes("--ignore-config"));
  assert.ok(downloadArgs.includes("--no-plugin-dirs"));
  assert.equal(downloadArgs.at(-2), "--");
  assert.equal(downloadArgs.at(-1), "https://www.instagram.com/reel/one/");
  for (const job of queue.state.jobs) await assert.rejects(fs.stat(path.join(directory, job.id)), { code: "ENOENT" });
  const saved = JSON.parse(await fs.readFile(path.join(directory, "state.json"), "utf8"));
  assert.equal(saved.folder, "/Enovashan Reels");
  assert.equal(JSON.stringify(saved).includes("pairing"), false);
});

test("upload failure retains the completed MP4 and Retry reuses it", async () => {
  const { queue, calls, options, directory } = await fixture({ uploadFailure: true });
  await queue.setFolder("/Enovashan Reels");
  await queue.add(["https://www.instagram.com/reel/one/"]);
  await idle(queue);
  const job = queue.state.jobs[0];
  assert.equal(job.status, "Failed");
  assert.match(job.error, /quota/);
  assert.ok((await fs.stat(path.join(directory, job.id, `${job.id}.mp4`))).isFile());
  options.uploadFailure = false;
  await queue.retry(job.id);
  await idle(queue);
  assert.equal(job.status, "Ok");
  assert.equal(calls.filter(call => call.name === "yt-dlp" && !call.args.includes("--version")).length, 1);
});

test("a failed video does not prevent later videos, and failed staging can be discarded", async () => {
  const { queue, options, directory } = await fixture({ downloadFailure: true });
  await queue.setFolder("/Enovashan Reels");
  await queue.add(["https://www.instagram.com/reel/one/"]);
  await idle(queue);
  const failed = queue.state.jobs[0];
  options.downloadFailure = false;
  await queue.add(["https://www.instagram.com/reel/two/"]);
  await idle(queue);
  assert.deepEqual(queue.state.jobs.map(job => job.status), ["Failed", "Ok"]);
  await queue.remove(failed.id);
  assert.equal(queue.state.jobs.length, 1);
  await assert.rejects(fs.stat(path.join(directory, failed.id)), { code: "ENOENT" });
});

test("cleanup-only retry never uploads a successfully uploaded video again", async () => {
  const { queue, calls } = await fixture();
  await queue.setFolder("/Enovashan Reels");
  const clean = queue.clean.bind(queue);
  queue.clean = async () => { throw new Error("Disk cleanup denied"); };
  await queue.add(["https://www.instagram.com/reel/one/"]);
  await idle(queue);
  const job = queue.state.jobs[0];
  assert.equal(job.status, "Failed");
  assert.equal(job.uploaded, true);
  assert.match(job.error, /Uploaded to MEGA/);
  queue.clean = clean;
  await queue.retry(job.id);
  await idle(queue);
  assert.equal(job.status, "Ok");
  assert.equal(calls.filter(call => call.command === "put").length, 1);
});

test("interrupted state becomes Failed rather than silently resuming", async () => {
  const { queue, directory, run } = await fixture();
  await queue.setFolder("/Enovashan Reels");
  await queue.add(["https://www.instagram.com/reel/one/"]);
  await idle(queue);
  queue.state.jobs[0].status = "Uploading";
  await queue.save();
  const restarted = new TransferQueue(directory, run, name => name);
  await restarted.init();
  assert.equal(restarted.state.jobs[0].status, "Failed");
  assert.match(restarted.state.jobs[0].error, /Check MEGA/);
  assert.equal(restarted.running, false);
});

test("missing login and unknown folders are explicit errors; invalid batches do not queue work", async () => {
  const { queue } = await fixture({ loginFailure: true });
  await assert.rejects(queue.setFolder("/missing"), /not found/);
  await assert.rejects(queue.add(["https://www.instagram.com/reel/one/"]), /Choose/);
  queue.state.folder = "/Enovashan Reels";
  await assert.rejects(queue.add(["https://www.instagram.com/reel/one/"]), /Not logged in/);
  await assert.rejects(queue.add(Array(51).fill("https://www.instagram.com/reel/one/")), /1 and 50/);
  await assert.rejects(queue.add(["https://evil.example/video"]), /Reel/);
  assert.deepEqual(queue.state.jobs, []);
});

test("loopback API restricts Host, Origin, pairing code, and permission confirmation", async t => {
  const { queue } = await fixture();
  const token = "a".repeat(64);
  const server = createServer(queue, token);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetch = (target, options = {}) => new Promise((resolve, reject) => {
    const request = http.request(target, options, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(new Response(
        response.statusCode === 204 ? null : Buffer.concat(chunks),
        { status: response.statusCode, headers: response.headers },
      )));
    });
    request.on("error", reject);
    request.end(options.body);
  });
  const headers = { host: `127.0.0.1:${PORT}`, origin: "https://www.enovashan.com", authorization: `Bearer ${token}` };
  const ok = await fetch(`${base}/status`, { headers });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://www.enovashan.com");
  assert.equal((await ok.json()).version, 1);
  for (const [change, status] of [
    [{ origin: "https://evil.example" }, 403],
    [{ host: "evil.example" }, 403],
    [{ authorization: "Bearer wrong" }, 401],
  ]) {
    assert.equal((await fetch(`${base}/status`, { headers: { ...headers, ...change } })).status, status);
  }
  const preflight = await fetch(`${base}/status`, { method: "OPTIONS", headers: { host: headers.host, origin: headers.origin } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
  const denied = await fetch(`${base}/jobs`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ links: ["https://www.instagram.com/reel/one/"] }),
  });
  assert.equal(denied.status, 400);
  assert.match((await denied.json()).error, /permission/);
  const malformed = await fetch(`${base}/folder`, { method: "POST", headers, body: "{" });
  assert.equal(malformed.status, 400);
  assert.ok((await malformed.json()).error);
});
