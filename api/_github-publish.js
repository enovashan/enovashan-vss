// Shared helper: commits generated static HTML pages + directory card snippets to GitHub so
// publishing in the CMS actually updates the live static site (instead of only saving metadata).

function getGithubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "enovashan/enovashan-vss";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) return null;
  return { token, repo, branch };
}

async function ghApi(config, path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${config.repo}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

async function ghGetFile(config, filePath) {
  const res = await ghApi(config, `/contents/${encodeURIComponent(filePath)}?ref=${config.branch}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub read failed for ${filePath}: ${text}`);
  }
  const data = await res.json();
  return {
    sha: data.sha,
    content: Buffer.from(data.content, "base64").toString("utf-8"),
  };
}

async function ghPutFile(config, filePath, content, message, sha) {
  const res = await ghApi(config, `/contents/${encodeURIComponent(filePath)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub write failed for ${filePath}: ${text}`);
  }
  return res.json();
}

async function ghDeleteFile(config, filePath, message, sha) {
  const res = await ghApi(config, `/contents/${encodeURIComponent(filePath)}`, {
    method: "DELETE",
    body: JSON.stringify({ message, branch: config.branch, sha }),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`GitHub delete failed for ${filePath}: ${text}`);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getTargetPageFilename(target) {
  const map = {
    stories: "stories.html",
    recipes: "recipes.html",
    "stories-urdu": "stories-urdu.html",
    "stories-arabic": "stories-arabic.html",
    books: "books.html",
    index: "index.html",
  };
  return map[target] || "stories.html";
}

function getTargetPageLabel(key) {
  const map = {
    stories: "Stories",
    recipes: "Recipes",
    "stories-urdu": "Stories Urdu",
    "stories-arabic": "Stories Arabic",
    books: "Book Notes",
    index: "Lead Story",
  };
  return map[key] || key;
}

// Builds the complete standalone static HTML page for an article (server-side port of the CMS composer logic)
function buildFullStaticHtml(post) {
  const { slug, title, summary, category, read_time, language, content_html, published_at, target_page } = post;
  const isRtl = language === "ur" || language === "ar";
  const langAttr = isRtl ? `lang="${language}" dir="rtl"` : 'lang="en"';
  const dateStr = published_at
    ? new Date(published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const fontLink = isRtl
    ? '<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap" rel="stylesheet" />'
    : '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />';
  const articleClass = isRtl ? "archive-article archive-article--urdu" : "archive-article";
  const metaText = escapeHtml(category ? `${category} \u00b7 ${dateStr}` : dateStr);

  return `<!DOCTYPE html>
<html ${langAttr}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} — Enovashan</title>
    <meta name="description" content="${escapeHtml(summary || title)}" />
    <link rel="canonical" href="https://www.enovashan.com/${escapeHtml(slug)}" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    ${fontLink}
    <link rel="stylesheet" href="styles.css" />
    <script src="analytics.js" defer><\/script>
    <script src="comments.js" defer><\/script>
    <script src="notifications.js" defer><\/script>
  </head>
  <body>
    <div class="page-shell page-shell--subpage">
      <header class="topbar" dir="ltr">
        <a class="brand" href="index.html" aria-label="Enovashan home">
          <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 58 58" focusable="false"><path class="brand-mark__frame" d="M15 49V11h29v17"/><path class="brand-mark__n" d="M22 43V22l16 18V22"/><circle class="brand-mark__signal" cx="45" cy="12" r="4"/></svg></div>
          <div class="brand-name">Enovashan</div>
        </a>
        <nav class="main-nav" aria-label="Main navigation">
          <a href="index.html">Home</a>
          <a href="stories.html">Stories</a><a href="books.html">Book notes</a><a href="watch.html">Watch</a><a href="recipes.html">Recipes</a><a href="shop.html">Shop</a><a href="about.html">About</a>
        </nav>
        <div class="toolbar">
          <div class="header-updates">
            <a href="search.html" class="search-icon" aria-label="Search the site" title="Search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
            </a>
            <a href="newsletter.html" class="newsletter-icon" aria-label="Join the dispatch newsletter" title="Join the dispatch">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>
            </a>
            <div class="notif-wrap">
              <button class="icon-button bell-button" id="notifBell" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Latest updates">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a6 6 0 00-6 6v3.09c0 .58-.18 1.14-.5 1.62l-1.3 1.9c-.76 1.12.03 2.64 1.38 2.64h12.84c1.35 0 2.14-1.52 1.38-2.64l-1.3-1.9a2.9 2.9 0 01-.5-1.62V8a6 6 0 00-6-6zm0 20a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22z"/></svg>
                <span class="notif-badge" id="notifBadge" hidden>0</span>
              </button>
              <div class="notif-panel" id="notifPanel" hidden role="menu" aria-label="Latest updates">
                <div class="notif-panel-header">Latest updates</div>
                <ul class="notif-list" id="notifList"></ul>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main class="content-page">
        <section class="page-hero tight-hero narrow-hero" ${isRtl ? 'dir="rtl"' : ""}>
          <div class="meta-label">${escapeHtml(category || "EDITORIAL")} / ${dateStr.toUpperCase()}</div>
          <h1>${escapeHtml(title)}</h1>
          ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
        </section>

        <article class="${articleClass}" ${isRtl ? 'dir="rtl"' : ""}>
          <div class="archive-article__meta">${metaText}</div>
          <div class="archive-article__body">
${content_html}
          </div>

          <section class="comments-section" data-comments data-article-slug="${escapeHtml(slug)}" ${isRtl ? 'dir="rtl"' : ""} aria-labelledby="comments-title">
            <div class="eyebrow">${isRtl ? "گفتگو" : "The conversation"}</div>
            <h2 id="comments-title">${isRtl ? "تبصرے" : "Comments"} <span data-comment-count>0</span></h2>
            <p class="comments-disclosure">${isRtl ? "تبصرے عوامی ہیں اور کسی اکاؤنٹ کی ضرورت نہیں ہے۔" : "Comments are public and do not require an account. Use a display name, and keep private information out of your post."}</p>
            <form class="comment-form" data-comment-form>
              <label>${isRtl ? "نام" : "Name"}<input name="name" type="text" maxlength="60" autocomplete="name" required /></label>
              <label>${isRtl ? "آپ کا تبصرہ" : "Your comment"}<textarea name="body" rows="4" maxlength="2000" required></textarea></label>
              <label class="comment-honeypot" aria-hidden="true">Leave this field empty<input name="website" type="text" tabindex="-1" autocomplete="off" /></label>
              <button class="comment-submit" type="submit">${isRtl ? "تبصرہ ارسال کریں" : "Post comment"} <span aria-hidden="true">&rarr;</span></button>
              <p class="comment-status" data-comment-status aria-live="polite"></p>
            </form>
            <ol class="comment-list" data-comment-list aria-label="Comments"></ol>
          </section>

          <a href="${getTargetPageFilename(target_page)}" class="primary-link" style="margin-top: 2rem;">Back to ${getTargetPageLabel(target_page)} <span>&rarr;</span></a>
        </article>
      </main>

      <footer class="site-footer">
        <div class="footer-bottom"><span>&copy; 2025 Enovashan</span><span>Built for the curious</span></div>
      </footer>
    </div>
  </body>
</html>`;
}

// Builds the directory-listing card snippet for a given post
function buildCardSnippet(post, { home = false } = {}) {
  const { slug, title, summary, category, read_time, language, target_page } = post;
  const isRtl = language === "ur" || language === "ar";

  if (home || target_page === "index") {
    return `<article class="archive-teaser" lang="${escapeHtml(language || "en")}"${isRtl ? ' dir="rtl"' : ""}>
  <div class="meta-row"><span>${escapeHtml(category || "Notes")}</span><span>${escapeHtml(read_time || "")}</span></div>
  <h3>${escapeHtml(title)}</h3>
  <p>${escapeHtml(summary || "")}</p>
  <a href="${escapeHtml(slug)}.html" class="inline-link">Read the story <span>&rarr;</span></a>
</article>`;
  }

  return `<article class="story-card" ${isRtl ? 'dir="rtl"' : ""}>
  <div class="story-badge">&bull;</div>
  <div class="story-meta"><span>${escapeHtml(category || "Notes")}</span><span>${escapeHtml(read_time || "Read")}</span></div>
  <h3><a href="${escapeHtml(slug)}.html">${escapeHtml(title)}</a></h3>
  <p>${escapeHtml(summary || "")}</p>
</article>`;
}

function markerStart(slug, kind = "card") {
  return `<!-- cms:${slug}:${kind} -->`;
}
function markerEnd(slug, kind = "card") {
  return `<!-- /cms:${slug}:${kind} -->`;
}

// Inserts or replaces a marked snippet block inside the given container, keeping newest first
function upsertSnippetInHtml(pageHtml, slug, snippetHtml, containerClass, kind = "card") {
  const block = `${markerStart(slug, kind)}\n${snippetHtml}\n${markerEnd(slug, kind)}`;
  const blockRe = new RegExp(`${markerStart(slug, kind).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${markerEnd(slug, kind).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

  if (blockRe.test(pageHtml)) {
    return pageHtml.replace(blockRe, block);
  }

  const containerRe = new RegExp(`(<div class="${containerClass}">)`);
  if (!containerRe.test(pageHtml)) {
    throw new Error(`Could not find container <div class="${containerClass}"> to insert the article card.`);
  }
  return pageHtml.replace(containerRe, `$1\n${block}`);
}

function removeSnippetFromHtml(pageHtml, slug, kind = "card") {
  const blockRe = new RegExp(`\\s*${markerStart(slug, kind).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${markerEnd(slug, kind).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  return pageHtml.replace(blockRe, "");
}

// Builds the item markup for the language lists on the home page
function buildSeriesItemSnippet(post) {
  const itemClass = { en: "english-series-item", ur: "urdu-series-item", ar: "arabic-series-item" }[post.language];
  return `<article class="${itemClass}">
  <h3><a href="${escapeHtml(post.slug)}.html">${escapeHtml(post.title)}</a></h3>
  <p>${escapeHtml(post.summary || "")}</p>
</article>`;
}

async function getLatestPublishedPosts() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) {
    throw new Error("Supabase configuration missing for latest homepage posts.");
  }
  const res = await fetch(`${url}/rest/v1/posts?select=slug,title,summary,category,read_time,language&status=eq.published&order=published_at.desc,slug.asc&limit=3`, {
    headers: {
      apikey: secretKey,
      ...(secretKey.startsWith("eyJ") ? { authorization: "Bearer " + secretKey } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to load latest homepage posts (HTTP ${res.status}).`);
  }
  return res.json();
}

function updateLatestPosts(homeHtml, posts) {
  const start = "<!-- latest-posts:start -->";
  const end = "<!-- latest-posts:end -->";
  const startIndex = homeHtml.indexOf(start);
  const endIndex = homeHtml.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Could not find the latest posts section on the home page.");
  }
  const cards = posts.map((post) => buildCardSnippet(post, { home: true })).join("\n");
  return homeHtml.slice(0, startIndex) + `${start}\n${cards}\n` + homeHtml.slice(endIndex);
}

async function updateSitemap(config, slug, published) {
  const sitemap = await ghGetFile(config, "sitemap.xml");
  if (!sitemap) throw new Error("Could not read sitemap.xml from the repository.");
  const entry = `<url><loc>https://www.enovashan.com/${slug}</loc></url>`;
  let content = sitemap.content.replace(entry, "");
  if (published) {
    if (!content.includes("</urlset>")) throw new Error("Invalid sitemap.xml: missing urlset.");
    content = content.replace("</urlset>", `${entry}</urlset>`);
  }
  if (content !== sitemap.content) {
    await ghPutFile(config, "sitemap.xml", content, `cms: update sitemap for ${slug}`, sitemap.sha);
  }
}

const goodWorkTranslations = {
  en: "the-architecture-of-good-work",
  ur: "good-work-urdu",
  ar: "the-architecture-goodwork-ar",
};

async function updateTranslationAlternates(config, slug) {
  if (!Object.values(goodWorkTranslations).includes(slug)) return;

  const articles = await Promise.all(
    Object.entries(goodWorkTranslations).map(async ([language, articleSlug]) => ({
      language,
      slug: articleSlug,
      file: await ghGetFile(config, `${articleSlug}.html`),
    }))
  );
  const published = articles.filter((article) => article.file);
  for (const article of published) {
    let html = article.file.content;
    for (const [language, articleSlug] of Object.entries(goodWorkTranslations)) {
      html = html.replace(
        `    <link rel="alternate" hreflang="${language}" href="https://www.enovashan.com/${articleSlug}" />\n`,
        ""
      );
    }
    const canonical = `    <link rel="canonical" href="https://www.enovashan.com/${article.slug}" />`;
    if (!html.includes(canonical)) throw new Error(`Missing canonical in ${article.slug}.html.`);
    if (published.length > 1) {
      const links = published.map(({ language, slug: articleSlug }) =>
        `    <link rel="alternate" hreflang="${language}" href="https://www.enovashan.com/${articleSlug}" />`
      ).join("\n");
      html = html.replace(canonical, `${canonical}\n${links}`);
    }
    if (html !== article.file.content) {
      await ghPutFile(config, `${article.slug}.html`, html, `cms: update translations for ${article.slug}`, article.file.sha);
    }
  }
}

// Commits the article page + inserts its card into the target (and optionally home) directory page
async function publishPostToGitHub(post) {
  const config = getGithubConfig();
  if (!config) {
    throw new Error("GitHub configuration missing (GITHUB_TOKEN).");
  }

  const articlePath = `${post.slug}.html`;
  const articleHtml = buildFullStaticHtml(post);
  const existingArticle = await ghGetFile(config, articlePath);
  await ghPutFile(config, articlePath, articleHtml, `cms: publish ${post.slug}`, existingArticle?.sha);

  if (post.target_page !== "index") {
    const targetFilename = getTargetPageFilename(post.target_page);
    const targetFile = await ghGetFile(config, targetFilename);
    if (!targetFile) {
      throw new Error(`Could not read ${targetFilename} from the repository.`);
    }
    const cardSnippet = buildCardSnippet(post);
    const updatedTargetHtml = upsertSnippetInHtml(targetFile.content, post.slug, cardSnippet, "story-list");
    await ghPutFile(config, targetFilename, updatedTargetHtml, `cms: list ${post.slug} on ${targetFilename}`, targetFile.sha);
  }

  // The latest posts and language lists live in index.html.
  const homeFile = await ghGetFile(config, "index.html");
  if (!homeFile) {
    throw new Error("Could not read index.html from the repository.");
  }
  let homeHtml = updateLatestPosts(homeFile.content, await getLatestPublishedPosts());

  homeHtml = removeSnippetFromHtml(homeHtml, post.slug, "series");
  if (["en", "ur", "ar"].includes(post.language)) {
    const listClass = { en: "english-series-list", ur: "urdu-series-list", ar: "arabic-series-list" }[post.language];
    homeHtml = upsertSnippetInHtml(homeHtml, post.slug, buildSeriesItemSnippet(post), listClass, "series");
  }

  if (homeHtml !== homeFile.content) {
    await ghPutFile(config, "index.html", homeHtml, `cms: update home page for ${post.slug}`, homeFile.sha);
  }

  await updateSitemap(config, post.slug, true);
  await updateTranslationAlternates(config, post.slug);
  return {
    articleUrl: `https://www.enovashan.com/${post.slug}`,
  };
}

// Removes the article page + its card snippets from every page it was published to
async function unpublishPostFromGitHub(post) {
  const config = getGithubConfig();
  if (!config) return;

  const articlePath = `${post.slug}.html`;
  const existingArticle = await ghGetFile(config, articlePath);
  if (existingArticle) {
    await ghDeleteFile(config, articlePath, `cms: remove ${post.slug}`, existingArticle.sha);
  }

  if (post.target_page !== "index") {
    const targetFilename = getTargetPageFilename(post.target_page);
    const targetFile = await ghGetFile(config, targetFilename);
    if (targetFile) {
      const updated = removeSnippetFromHtml(targetFile.content, post.slug);
      if (updated !== targetFile.content) {
        await ghPutFile(config, targetFilename, updated, `cms: unlist ${post.slug} from ${targetFilename}`, targetFile.sha);
      }
    }
  }

  const homeFile = await ghGetFile(config, "index.html");
  if (homeFile) {
    let homeHtml = updateLatestPosts(homeFile.content, await getLatestPublishedPosts());
    homeHtml = removeSnippetFromHtml(homeHtml, post.slug, "series");
    if (homeHtml !== homeFile.content) {
      await ghPutFile(config, "index.html", homeHtml, `cms: unfeature ${post.slug} from home`, homeFile.sha);
    }
  }
  await updateSitemap(config, post.slug, false);
  await updateTranslationAlternates(config, post.slug);
}

module.exports = {
  getGithubConfig,
  publishPostToGitHub,
  unpublishPostFromGitHub,
};
