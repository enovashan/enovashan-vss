from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring


ROOT = Path(__file__).resolve().parent
EXCLUDED = {"about-recovered-raw.html", "cart.html", "search.html", "shop.html"}
ORIGIN = "https://www.enovashan.com"

urlset = Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
for path in sorted(ROOT.glob("*.html")):
    if path.name in EXCLUDED:
        continue
    url = SubElement(urlset, "url")
    SubElement(url, "loc").text = ORIGIN + ("/" if path.stem == "index" else f"/{path.stem}")

(ROOT / "sitemap.xml").write_bytes(
    b'<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(urlset, encoding="utf-8") + b"\n"
)
