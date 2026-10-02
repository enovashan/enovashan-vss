from html.parser import HTMLParser
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CMS_ARTICLES = {
    "good-work-urdu.html",
    "the-architecture-goodwork-ar.html",
    "the-architecture-of-good-work.html",
}


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_main = False
        self.skip = 0
        self.title = []
        self.heading = []
        self.text = []
        self.in_title = False
        self.in_heading = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag == "main":
            self.in_main = True
        if tag in ("script", "style", "nav", "form") and self.in_main:
            self.skip += 1
        if tag == "h1" and self.in_main:
            self.in_heading = True

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "h1":
            self.in_heading = False
        if tag in ("script", "style", "nav", "form") and self.in_main:
            self.skip -= 1
        if tag == "main":
            self.in_main = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.in_heading:
            self.heading.append(data)
        if self.in_main and not self.skip:
            self.text.append(data)


def clean(parts):
    return " ".join(" ".join(parts).split())


pages = []
for path in sorted(ROOT.glob("*.html")):
    if path.name in CMS_ARTICLES or path.name == "search.html":
        continue
    parser = PageText()
    parser.feed(path.read_text(encoding="utf-8"))
    if not parser.text:
        continue
    title = clean(parser.heading) or clean(parser.title).split(" — ")[0]
    pages.append({"url": path.name, "title": title, "text": clean(parser.text)})

(ROOT / "search-index.json").write_text(
    json.dumps(pages, ensure_ascii=False, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
print(f"Indexed {len(pages)} static pages")
