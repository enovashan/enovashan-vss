from __future__ import annotations

import html
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET


DEFAULT_CANDIDATES = [
    Path(r"C:\Users\shujaat\Downloads\enovashan-content-import.xml"),
    Path(r"C:\Users\shujaat\Downloads\enovashan-com-20260825-101739-5mf3c2tibf0m.wpress"),
    Path(__file__).resolve().parent / "enovashan-content-import.xml",
    Path(__file__).resolve().parent / "enovashan-com-20260825-101739-5mf3c2tibf0m.wpress",
]

OUT_DIR = Path(__file__).resolve().parent
BLOG_DIR = OUT_DIR / "blog"
WP_XML = None


ns = {
    "content": "http://purl.org/rss/1.0/modules/content/",
    "wp": "http://wordpress.org/export/1.2/",
    "excerpt": "http://wordpress.org/export/1.2/excerpt/",
}


def strip_wordpress_blocks(raw: str | None) -> str:
    if not raw:
        return ""
    text = raw
    text = re.sub(r"<!--\s*/?wp:[^>]*-->", "", text)
    text = re.sub(r"<!--\s*.*?\s*-->", "", text, flags=re.S)
    text = re.sub(r"<p>\s*</p>", "", text, flags=re.S)
    return text.strip()


def sanitize_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9\-\s]", "", value)
    slug = slug.strip().lower().replace(" ", "-")
    slug = re.sub(r"-+", "-", slug)
    return slug or "post"


def find_wordpress_export_file() -> Path | None:
    for candidate in DEFAULT_CANDIDATES:
        if not candidate.exists():
            continue
        if candidate.suffix.lower() == ".xml":
            return candidate
    return None


def ensure_wordpress_export():
    global WP_XML
    if WP_XML is not None:
        return WP_XML
    WP_XML = find_wordpress_export_file()
    if WP_XML is None:
        raise FileNotFoundError(
            "No WordPress export file found. Expected a .xml export or a .wpress backup in the Downloads folder or project directory."
        )
    return WP_XML


def extract_posts():
    source_path = ensure_wordpress_export()
    root = ET.parse(source_path).getroot()
    items = root.findall("./channel/item")
    posts = []
    for item in items:
        post_type = item.findtext("{http://wordpress.org/export/1.2/}post_type")
        status = item.findtext("{http://wordpress.org/export/1.2/}status")
        if post_type != "post" or status != "publish":
            continue

        title = html.unescape(item.findtext("title") or "Untitled")
        slug = item.findtext("{http://wordpress.org/export/1.2/}post_name") or sanitize_slug(title)
        slug = sanitize_slug(slug)
        content = strip_wordpress_blocks(item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded"))
        excerpt = item.findtext("{http://wordpress.org/export/1.2/excerpt/}encoded") or ""
        excerpt = strip_wordpress_blocks(excerpt)
        if not excerpt:
            excerpt = re.sub(r"<[^>]+>", " ", content)
            excerpt = re.sub(r"\s+", " ", excerpt).strip()
            excerpt = excerpt[:180] + ("..." if len(excerpt) > 180 else "")

        category_nodes = item.findall("category")
        categories = []
        for node in category_nodes:
            if node is not None and node.text:
                categories.append(node.text.strip())

        posts.append(
            {
                "title": title,
                "slug": slug,
                "content": content,
                "excerpt": excerpt,
                "category": categories[0] if categories else "General",
                "date": item.findtext("{http://wordpress.org/export/1.2/}post_date") or "",
                "link": item.findtext("link") or f"https://enovashan.com/{slug}/",
            }
        )

    return sorted(posts, key=lambda p: p["date"], reverse=False)


def render_story_cards(posts):
    cards = []
    for index, post in enumerate(posts[:12], start=1):
        page_path = f"blog/{post['slug']}.html"
        cards.append(
            f'''
            <article class="story-card">
              <div class="story-badge">{index:02d}</div>
              <div class="story-meta"><span>{html.escape(post['category'])}</span><span>{post['date'][:10] if post['date'] else 'Published'}</span></div>
              <h3>{html.escape(post['title'])}</h3>
              <p>{html.escape(post['excerpt'])}</p>
              <a href="{page_path}" class="inline-link">Read article <span>→</span></a>
            </article>
            '''
        )
    return "\n".join(cards)


def render_story_page(posts):
    cards = render_story_cards(posts)
    template = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Stories — Enovashan</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div class="page-shell page-shell--subpage">
      <header class="topbar">
        <a class="brand" href="index.html" aria-label="Enovashan home">
          <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 58 58" focusable="false"><path class="brand-mark__frame" d="M15 49V11h29v17"/><path class="brand-mark__n" d="M22 43V22l16 18V22"/><circle class="brand-mark__signal" cx="45" cy="12" r="4"/></svg></div>
          <div class="brand-name">Enovashan</div>
        </a>

        <nav class="main-nav" aria-label="Main navigation">
          <a href="index.html">Home</a>
          <a href="stories.html">Stories</a>
          <a href="books.html">Book notes</a>
          <a href="watch.html">Watch</a>
          <a href="books.html">Learn</a>
          <a href="recipes.html">Recipes</a>
          <a href="shop.html">Shop</a>
          <a href="about.html">About</a>
        </nav>

        <div class="toolbar">
          <a href="stories.html" class="icon-button" aria-label="Search stories">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 015.12 11.12l4.38 4.38 1.41-1.41-4.38-4.38A6.5 6.5 0 1110.5 4zm0 2a4.5 4.5 0 100 9 4.5 4.5 0 000-9z"/></svg>
          </a>
          <a href="cart.html" class="icon-button cart-link" aria-label="Cart">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7V6a5 5 0 0110 0v1h2.5l-1.1 11.1A2 2 0 0116.4 20H7.6a2 2 0 01-1.99-1.9L4.5 7H7zm2 0h6V6a3 3 0 10-6 0v1z"/></svg>
          </a>
        </div>
      </header>

      <main class="content-page">
        <section class="page-hero tight-hero">
          <div class="meta-label">ENOVASHAN / EDITORIAL INDEX</div>
          <h1>Stories for the in-between.</h1>
          <p>Essays, field notes, and small provocations about making a life with more signal and less static.</p>
        </section>

        <section class="story-directory">
          <div class="story-directory__filters">
            <span>All notes</span>
            <span>Ideas</span>
            <span>Work</span>
            <span>Books</span>
          </div>

          <div class="story-list">
            {cards}
          </div>
        </section>

        <aside class="editor-note">
          <div class="eyebrow">Editor’s note</div>
          <h2>Keep this tab open.</h2>
          <p>New stories arrive when they have earned their way here. No filler, no frantic publishing calendar.</p>
          <a href="newsletter.html" class="primary-link">Get the signal <span>→</span></a>
        </aside>
      </main>

      <footer class="site-footer">
        <div class="footer-top">
          <div class="footer-lead">
            <p>Enovashan is a home for ideas to help you <em>navigate life, thoughtfully</em>.</p>
          </div>

          <nav class="footer-nav" aria-label="Footer navigation">
            <a href="stories.html">Stories</a>
            <a href="books.html">Book notes</a>
            <a href="watch.html">Watch</a>
            <a href="recipes.html">Recipes</a>
            <a href="about.html">About</a>
            <a href="contact.html">Contact</a>
          </nav>

          <div class="footer-languages">
            <div class="small-label">Languages / three doors in</div>
            <p class="footer-lang-links"><a href="index.html#english-series-card">English</a>, <a href="index.html#urdu-series-card">اردو</a>, <a href="index.html#arabic-series-card">العربية</a>.</p>
            <p>Same curiosity. Different cadence.</p>
            <a href="newsletter.html" class="primary-link footer-link">Join the dispatch <span>→</span></a>
          </div>
        </div>

        <div class="footer-bottom">
          <span>© 2025 Enovashan</span>
          <span>Built for the curious</span>
        </div>
      </footer>
    </div>
  </body>
</html>
"""
    return template.format(cards=cards)


def render_comments_section(post):
    slug = html.escape(post["slug"], quote=True)
    return f'''<section class="comments-section" data-comments data-article-slug="{slug}" aria-labelledby="comments-title">
          <div class="eyebrow">The conversation</div>
          <h2 id="comments-title">Comments <span data-comment-count>0</span></h2>
          <p class="comments-disclosure">Comments are public and do not require an account. Use a display name, and keep private information out of your post.</p>
          <form class="comment-form" data-comment-form>
            <label>Name<input name="name" type="text" maxlength="60" autocomplete="name" required /></label>
            <label>Your comment<textarea name="body" rows="4" maxlength="2000" required></textarea></label>
            <label class="comment-honeypot" aria-hidden="true">Leave this field empty<input name="website" type="text" tabindex="-1" autocomplete="off" /></label>
            <button class="comment-submit" type="submit">Post comment <span aria-hidden="true">→</span></button>
            <p class="comment-status" data-comment-status aria-live="polite"></p>
          </form>
          <ol class="comment-list" data-comment-list aria-label="Comments"></ol>
        </section>'''


def render_post_page(post):
    content_html = post["content"]
    comments_html = render_comments_section(post)
    template = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title} — Enovashan</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="../styles.css" />
    <script src="../comments.js" defer></script>
  </head>
  <body>
    <div class="page-shell page-shell--subpage">
      <header class="topbar">
        <a class="brand" href="../index.html" aria-label="Enovashan home">
          <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 58 58" focusable="false"><path class="brand-mark__frame" d="M15 49V11h29v17"/><path class="brand-mark__n" d="M22 43V22l16 18V22"/><circle class="brand-mark__signal" cx="45" cy="12" r="4"/></svg></div>
          <div class="brand-name">Enovashan</div>
        </a>
        <nav class="main-nav" aria-label="Main navigation">
          <a href="../index.html">Home</a>
          <a href="../stories.html">Stories</a>
          <a href="../books.html">Book notes</a>
          <a href="../watch.html">Watch</a>
          <a href="../recipes.html">Recipes</a>
          <a href="../shop.html">Shop</a>
          <a href="../about.html">About</a>
        </nav>
      </header>

      <main class="content-page">
        <section class="page-hero tight-hero">
          <div class="meta-label">ENOVASHAN / {category}</div>
          <h1>{title}</h1>
          <p>{excerpt}</p>
        </section>

        <article class="editor-note" style="max-width: 780px;">
          {content}
          <p style="margin-top: 2rem;"><a href="../stories.html" class="primary-link">Back to stories <span>→</span></a></p>
        </article>
        {comments}
      </main>

      <footer class="site-footer">
        <div class="footer-bottom">
          <span>© 2025 Enovashan</span>
          <span>Built for the curious</span>
        </div>
      </footer>
    </div>
  </body>
</html>
"""
    return template.format(
        title=html.escape(post["title"]),
        category=html.escape(post["category"]),
        excerpt=html.escape(post["excerpt"]),
        content=content_html,
        comments=comments_html,
    )


def main():
    try:
        posts = extract_posts()
    except FileNotFoundError as exc:
        print(f"WordPress export not found: {exc}")
        return

    BLOG_DIR.mkdir(exist_ok=True)

    json_path = OUT_DIR / "blog-posts.json"
    json_path.write_text(json.dumps(posts, ensure_ascii=False, indent=2), encoding="utf-8")

    stories_html = OUT_DIR / "stories.html"
    stories_html.write_text(render_story_page(posts), encoding="utf-8")

    for post in posts:
        page_path = BLOG_DIR / f"{post['slug']}.html"
        page_path.write_text(render_post_page(post), encoding="utf-8")

    print(f"Converted {len(posts)} posts from WordPress export to static HTML.")
    print(f"Main page: {stories_html}")
    print(f"JSON data: {json_path}")
    print(f"Post folder: {BLOG_DIR}")


if __name__ == "__main__":
    main()
