(() => {
  const HELPER = "http://127.0.0.1:47831";
  let pairingCode = "";
  let timer;
  let generation = 0;
  let busy = false;
  const element = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);

  async function request(route, body) {
    if (!pairingCode) throw new Error("Start the helper and enter its pairing code first.");
    const current = generation;
    let response;
    try {
      response = await fetch(`${HELPER}${route}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${pairingCode}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(65000),
        credentials: "omit",
        cache: "no-store",
      });
    } catch (error) {
      throw new Error(`Cannot reach the local helper. Keep its terminal running and allow local-network access in your browser. ${error.message}`);
    }
    const data = await response.json();
    if (current !== generation) throw new Error("Helper was disconnected.");
    if (!response.ok) throw new Error(data.error || `Helper request failed (${response.status}).`);
    return data;
  }

  function showError(error) {
    element("videoHelperStatus").textContent = error.message;
    element("videoHelperStatus").setAttribute("role", "alert");
  }

  function render(data) {
    if (data.version !== 1 || !Array.isArray(data.jobs)) throw new Error("Unsupported helper version. Download the current helper and restart it.");
    if (data.fatalError) throw new Error(data.fatalError);
    element("videoCurrentFolder").textContent = data.folder || "No MEGA folder selected";
    element("videoJobs").innerHTML = data.jobs.map(job => {
      const complete = job.status === "Ok";
      const failed = job.status === "Failed";
      return `<tr>
        <td><span>${escape(job.url)}</span><br /><small>MEGA: ${escape(job.folder)}/${escape(job.id)}.mp4</small></td>
        <td><strong>${escape(job.status)}</strong>${job.error ? `<p>${escape(job.error)}</p>` : ""}</td>
        <td>${failed ? `<button type="button" class="cms-btn-secondary" data-action="retry" data-id="${escape(job.id)}">Retry</button>` : ""}
        ${complete || failed ? `<button type="button" class="cms-btn-secondary" data-action="remove" data-id="${escape(job.id)}">${failed ? "Discard temp files & remove" : "Remove from list"}</button>` : ""}</td>
      </tr>`;
    }).join("");
    element("videoEmptyQueue").hidden = data.jobs.length !== 0;
  }

  async function poll() {
    const current = generation;
    try {
      const data = await request("/status");
      if (current !== generation) return;
      render(data);
      element("videoHelperStatus").textContent = "Helper connected. Keep the computer awake, helper terminal open, and CMS running.";
      element("videoHelperStatus").setAttribute("role", "status");
    } catch (error) {
      if (current !== generation) return;
      disconnectVideoHelper();
      showError(error);
      return;
    }
    timer = setTimeout(poll, 2500);
  }

  function disconnectVideoHelper() {
    generation++;
    clearTimeout(timer);
    pairingCode = "";
    element("videoPairingCode").value = "";
    element("videoConnectedControls").hidden = true;
    element("videoJobs").innerHTML = "";
    element("videoToolChecks").textContent = "";
    element("videoFolderChoices").replaceChildren();
    element("videoHelperStatus").textContent = "Helper disconnected. Existing transfers continue in the helper.";
  }
  window.disconnectVideoHelper = disconnectVideoHelper;

  async function action(callback) {
    if (busy) return;
    busy = true;
    const current = generation;
    element("videoActionStatus").textContent = "Working...";
    try {
      await callback();
      if (current === generation) element("videoActionStatus").textContent = "";
    } catch (error) {
      if (current === generation) {
        element("videoActionStatus").textContent = error.message;
        showError(error);
      }
    } finally {
      busy = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    element("videoConnectBtn").addEventListener("click", async () => {
      const code = element("videoPairingCode").value.trim();
      disconnectVideoHelper();
      if (!/^[a-f0-9]{64}$/.test(code)) return showError(new Error("Paste the 64-character pairing code printed by the helper."));
      pairingCode = code;
      const current = generation;
      try {
        render(await request("/status"));
        if (current !== generation) return;
        element("videoConnectedControls").hidden = false;
        await poll();
        if (!pairingCode || current !== generation) return;
        const data = await request("/check");
        if (current !== generation) return;
        element("videoToolChecks").textContent = data.checks.map(check =>
          `${check.name}: ${check.ok ? "Ready" : check.error}`).join("\n");
      } catch (error) {
        if (current !== generation) return;
        disconnectVideoHelper();
        showError(error);
      }
    });
    element("videoBrowseBtn").addEventListener("click", () => action(async () => {
      const data = await request("/folders");
      const select = element("videoFolderChoices");
      select.replaceChildren();
      for (const folder of data.folders) {
        const option = document.createElement("option");
        option.value = option.textContent = folder;
        option.selected = folder === element("videoCurrentFolder").textContent;
        select.append(option);
      }
      select.hidden = false;
      element("videoSaveFolderBtn").hidden = false;
    }));
    element("videoSaveFolderBtn").addEventListener("click", () => action(async () => {
      await request("/folder", { folder: element("videoFolderChoices").value });
      render(await request("/status"));
    }));
    element("videoSubmitBtn").addEventListener("click", () => action(async () => {
      if (!element("videoPermission").checked) throw new Error("Confirm you own the videos or have permission to download and store them.");
      const links = element("videoLinks").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      await request("/jobs", { links, permission: true });
      element("videoLinks").value = "";
      render(await request("/status"));
    }));
    element("videoJobs").addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const { action: operation, id } = button.dataset;
      if (operation === "remove" && !confirm("Remove this entry and delete any temporary files for it? Files already in MEGA are not deleted.")) return;
      action(async () => {
        await request(`/${operation}`, { id });
        render(await request("/status"));
      });
    });
    element("videoDisconnectBtn").addEventListener("click", disconnectVideoHelper);
  });
})();
