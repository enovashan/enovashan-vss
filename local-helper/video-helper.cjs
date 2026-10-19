#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { execFile } = require("node:child_process");

const PORT = 47831;
const ORIGINS = new Set(["https://www.enovashan.com", "https://enovashan.com"]);
const ACTIVE = new Set(["Pending", "Downloading", "Uploading"]);

function validateLink(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid Reel link: ${value}`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Reel links must use HTTPS without credentials or custom ports.");
  }
  const instagram = ["instagram.com", "www.instagram.com"].includes(url.hostname) &&
    /^\/reels?\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  const facebook = ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"].includes(url.hostname) &&
    /^\/(?:reels?\/\d+|share\/r\/[A-Za-z0-9_-]+)\/?$/.test(url.pathname);
  if (!instagram && !facebook) throw new Error("Use a Facebook Reel or Instagram Reel page link, not a profile, shortener, or other website.");
  url.search = "";
  url.hash = "";
  return url.href;
}

function validateFolder(value) {
  if (typeof value !== "string" || value.length > 500 || !value.startsWith("/") ||
      /[\x00-\x1f\x7f*?\\]/.test(value) || value.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Choose an absolute MEGA folder such as /Enovashan Reels (no wildcards).");
  }
  return value.replace(/\/+$/, "") || "/";
}

function findExecutable(name, platform = process.platform, env = process.env) {
  const directories = (env.PATH || "").split(path.delimiter).map(dir => dir.replace(/^"|"$/g, ""));
  if (platform === "win32" && name === "MegaClient") {
    directories.push(path.join(env.LOCALAPPDATA || "", "MEGAcmd"), path.join(env.ProgramFiles || "", "MEGAcmd"));
  }
  if (platform === "darwin" && name.startsWith("mega-")) {
    directories.push("/Applications/MEGAcmd.app/Contents/MacOS");
  }
  const filename = platform === "win32" ? `${name}.exe` : name;
  const found = directories.filter(Boolean).map(dir => path.join(dir, filename)).find(existsSync);
  if (!found) throw new Error(`${filename} was not found. Install it and restart the helper from a new terminal. See the setup guide.`);
  return found;
}

function runCommand(file, args, timeout = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { shell: false, windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${stderr || stdout || error.message}`.replace(/\x1b\[[0-9;]*m/g, "").trim().slice(-2000);
        reject(new Error(`${path.basename(file)} failed${error.killed ? " (timed out)" : ""}: ${detail}`));
      } else resolve(stdout.trim());
    });
  });
}

class TransferQueue {
  constructor(directory, run = runCommand, locate = findExecutable) {
    this.directory = directory;
    this.run = run;
    this.locate = locate;
    this.state = { folder: "", jobs: [] };
    this.running = false;
    this.fatalError = "";
    this.saveChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.state = JSON.parse(await fs.readFile(path.join(this.directory, "state.json"), "utf8"));
      if (typeof this.state.folder !== "string" || !Array.isArray(this.state.jobs)) throw new Error("Invalid helper state file.");
      for (const job of this.state.jobs) {
        if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error("Invalid job identifier in helper state.");
        validateLink(job.url);
        validateFolder(job.folder);
        if (ACTIVE.has(job.status)) {
          job.status = "Failed";
          job.error = "Helper stopped before completion. Check MEGA before retrying an upload.";
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await this.save();
  }

  async save() {
    const data = JSON.stringify(this.state, null, 2);
    this.saveChain = this.saveChain.then(async () => {
      const temporary = path.join(this.directory, "state.json.tmp");
      await fs.writeFile(temporary, data, { mode: 0o600 });
      await fs.rename(temporary, path.join(this.directory, "state.json"));
    });
    await this.saveChain;
  }

  mega(command, args = [], timeout) {
    if (process.platform === "win32") return this.run(this.locate("MegaClient"), [command, ...args], timeout);
    return this.run(this.locate(`mega-${command}`), args, timeout);
  }

  async check() {
    const checks = [];
    for (const [name, action] of [
      ["yt-dlp", () => this.run(this.locate("yt-dlp"), ["--version"], 15000)],
      ["FFmpeg", () => this.run(this.locate("ffmpeg"), ["-version"], 15000)],
      ["MEGA login", () => this.mega("whoami", [], 15000)],
    ]) {
      try { await action(); checks.push({ name, ok: true }); }
      catch (error) { checks.push({ name, ok: false, error: error.message }); }
    }
    return checks;
  }

  async folders() {
    const output = await this.mega("find", ["/", "--type=d"], 30000);
    const folders = output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("/"));
    return [...new Set(["/", ...folders.map(validateFolder)])].sort();
  }

  async setFolder(value) {
    const folder = validateFolder(value);
    const folders = await this.folders();
    if (!folders.includes(folder)) throw new Error("That MEGA folder was not found. Create it in MEGA, then click Browse again.");
    this.state.folder = folder;
    await this.save();
  }

  async add(links) {
    if (this.fatalError) throw new Error(this.fatalError);
    if (!Array.isArray(links) || !links.length || links.length > 50 || links.some(link => typeof link !== "string" || link.length > 2048)) {
      throw new Error("Submit between 1 and 50 Reel links.");
    }
    if (!this.state.folder) throw new Error("Choose and save a MEGA folder first.");
    if (this.state.jobs.length + links.length > 500) throw new Error("Queue history is full. Remove completed or failed jobs before adding more.");
    const urls = [...new Set(links.map(validateLink))];
    const checks = await this.check();
    const failures = checks.filter(check => !check.ok);
    if (failures.length) throw new Error(failures.map(check => check.error).join("\n"));
    const createdAt = new Date().toISOString();
    this.state.jobs.push(...urls.map(url => ({
      id: randomUUID(), url, folder: this.state.folder, status: "Pending", error: "",
      createdAt, uploaded: false, file: "",
    })));
    await this.save();
    this.start();
  }

  async clean(job) {
    const directory = path.join(this.directory, job.id);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (!entry.isFile()) throw new Error("Unexpected non-file in this job's temporary directory; manual cleanup required.");
      await fs.unlink(path.join(directory, entry.name));
    }
    await fs.rmdir(directory);
  }

  async retry(id) {
    if (this.fatalError) throw new Error(this.fatalError);
    const job = this.state.jobs.find(item => item.id === id);
    if (!job || job.status !== "Failed") throw new Error("Only failed jobs can be retried.");
    job.status = "Pending";
    job.error = "";
    await this.save();
    this.start();
  }

  async remove(id) {
    const job = this.state.jobs.find(item => item.id === id);
    if (!job || ACTIVE.has(job.status)) throw new Error("Only completed or failed jobs can be removed.");
    await this.clean(job);
    this.state.jobs = this.state.jobs.filter(item => item.id !== id);
    await this.save();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.process().catch(error => {
      this.fatalError = `Queue stopped: ${error.message}. Resolve the storage error and restart the helper.`;
      console.error(this.fatalError);
    }).finally(() => { this.running = false; });
  }

  async process() {
    let job;
    while ((job = this.state.jobs.find(item => item.status === "Pending"))) {
      try {
        const directory = path.join(this.directory, job.id);
        await fs.mkdir(directory, { mode: 0o700, recursive: true });
        if (!job.uploaded) {
          const file = path.join(directory, `${job.id}.mp4`);
          if (!job.file) {
            job.status = "Downloading";
            await this.save();
            await this.run(this.locate("yt-dlp"), [
              "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-progress",
              "--no-cache-dir", "--restrict-filenames", "--socket-timeout", "30",
              "--retries", "2", "--fragment-retries", "2", "--max-filesize", "500M",
              "--match-filters", "duration <= 600",
              "--ffmpeg-location", this.locate("ffmpeg"),
              "-f", "bv*+ba/b", "--merge-output-format", "mp4", "--remux-video", "mp4",
              "-P", directory, "-o", `${job.id}.%(ext)s`, "--", job.url,
            ]);
            const stat = await fs.stat(file);
            if (!stat.isFile() || !stat.size || stat.size > 500 * 1024 * 1024) throw new Error("No usable MP4 was produced, or the video exceeds 500 MB.");
            job.file = `${job.id}.mp4`;
          }
          job.status = "Uploading";
          await this.save();
          // Without -q, MEGAcmd waits for the upload to finish before returning.
          await this.mega("put", [file, `${job.folder.replace(/\/$/, "")}/`]);
          await this.mega("ls", [`${job.folder.replace(/\/$/, "")}/${job.id}.mp4`], 30000);
          job.uploaded = true;
          await this.save();
        }
        await this.clean(job);
        job.status = "Ok";
        job.file = "";
        job.error = "";
      } catch (error) {
        job.status = "Failed";
        job.error = `${job.uploaded ? "Uploaded to MEGA, but temporary cleanup failed. Retry only cleans local files. " : ""}${error.message}`;
      }
      await this.save();
    }
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function createServer(queue, token) {
  let mutation = false;
  return http.createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    const reply = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.host !== `127.0.0.1:${PORT}` || !ORIGINS.has(request.headers.origin)) {
      return reply(403, { error: "Only the Enovashan CMS may connect to this loopback helper." });
    }
    response.setHeader("access-control-allow-origin", request.headers.origin);
    response.setHeader("vary", "Origin");
    if (request.method === "OPTIONS") {
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "authorization, content-type");
      response.setHeader("access-control-allow-private-network", "true");
      response.writeHead(204);
      return response.end();
    }
    const provided = Buffer.from(request.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return reply(401, { error: "Invalid pairing code. Copy the code from the running helper terminal." });
    }
    const route = new URL(request.url, `http://127.0.0.1:${PORT}`).pathname;
    const writing = request.method === "POST";
    if (writing && mutation) return reply(409, { error: "Another action is in progress. Try again shortly." });
    if (writing) mutation = true;
    try {
      if (request.method === "GET" && route === "/status") {
        return reply(200, { version: 1, folder: queue.state.folder, jobs: queue.state.jobs, fatalError: queue.fatalError });
      }
      if (request.method === "GET" && route === "/check") return reply(200, { checks: await queue.check() });
      if (request.method === "GET" && route === "/folders") return reply(200, { folders: await queue.folders() });
      if (writing) {
        const input = await readBody(request);
        if (route === "/folder") await queue.setFolder(input.folder);
        else if (route === "/jobs") {
          if (input.permission !== true) throw new Error("Confirm that you own these videos or have permission to download and store them.");
          await queue.add(input.links);
        } else if (route === "/retry") await queue.retry(input.id);
        else if (route === "/remove") await queue.remove(input.id);
        else return reply(404, { error: "Unknown helper endpoint." });
        return reply(200, { accepted: true });
      }
      return reply(404, { error: "Unknown helper endpoint." });
    } catch (error) {
      return reply(400, { error: error.message });
    } finally {
      if (writing) mutation = false;
    }
  });
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error("Install Node.js 22 or newer before starting the helper.");
  const directory = path.join(os.homedir(), ".enovashan-video-helper");
  const token = randomBytes(32).toString("hex");
  const queue = new TransferQueue(directory);
  const server = createServer(queue, token);
  server.on("error", error => {
    console.error(`Helper could not listen: ${error.message}`);
    process.exitCode = 1;
  });
  // Bind before loading state so a second helper cannot modify the active queue.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  try { await queue.init(); }
  catch (error) { server.close(); throw error; }
  console.log(`Enovashan video helper: http://127.0.0.1:${PORT}\n\nConnect CMS (Ctrl+click on Windows, Command+click on Mac):\n${pairingUrl(token)}\n\nManual pairing code: ${token}\nKeep the link and code private; both expire when this helper stops.\nLocal temporary files and queue: ${directory}\nKeep this terminal running. MEGA login is handled separately by MEGAcmd.\nAfter an interruption, check MEGA before retrying failed uploads.`);
}

function pairingUrl(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid pairing code.");
  return `https://www.enovashan.com/cms#video-helper=${token}`;
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { TransferQueue, validateLink, validateFolder, createServer, pairingUrl, PORT };
