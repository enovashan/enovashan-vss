// "Latest updates" bell: shows a badge count of articles published in the last 7 days.
// The count is purely time-based (computed fresh on every page load), so it naturally clears itself
// once a week passes with no new publications — no per-visitor tracking involved.
(function () {
  const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  document.addEventListener("DOMContentLoaded", async () => {
    const bell = document.getElementById("notifBell");
    const badge = document.getElementById("notifBadge");
    const panel = document.getElementById("notifPanel");
    const list = document.getElementById("notifList");
    if (!bell || !badge || !panel || !list) return;

    list.innerHTML = '<li class="notif-empty">Loading updates…</li>';
    bell.addEventListener("click", () => {
      const isOpen = !panel.hidden;
      panel.hidden = isOpen;
      bell.setAttribute("aria-expanded", String(!isOpen));
    });

    document.addEventListener("click", (event) => {
      if (!panel.hidden && !event.target.closest(".notif-wrap")) {
        panel.hidden = true;
        bell.setAttribute("aria-expanded", "false");
      }
    });

    try {
      const res = await fetch("/api/posts-feed");
      if (!res.ok) throw new Error(`Updates feed failed (HTTP ${res.status}).`);
      const data = await res.json();
      const posts = data.posts || [];

      const now = Date.now();
      const recent = posts.filter((p) => p.published_at && now - new Date(p.published_at).getTime() <= RECENT_WINDOW_MS);

      if (recent.length > 0) {
        badge.textContent = String(recent.length);
        badge.hidden = false;
      }

      list.innerHTML = recent
        .map((p) => {
          const href = p.target_page === "index" ? "index.html" : `${p.slug}.html`;
          return `<li><a href="${href}"><span class="notif-item-title">${escapeHtml(p.title)}</span><span class="notif-item-summary">${escapeHtml(p.summary || "")}</span></a></li>`;
        })
        .join("") || '<li class="notif-empty">No new updates this week.</li>';
    } catch {
      list.innerHTML = '<li class="notif-empty">Updates are unavailable right now.</li>';
    }
  });

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
