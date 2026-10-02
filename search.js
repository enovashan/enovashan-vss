const form = document.querySelector("#site-search-form");
const input = form.querySelector("input");
const status = document.querySelector("#search-status");
const results = document.querySelector("#search-results");
let requestId = 0;

function preview(text, query) {
  const position = text.toLocaleLowerCase().indexOf(query);
  const start = Math.max(0, position - 60);
  return `${start ? "…" : ""}${text.slice(start, start + 190)}${start + 190 < text.length ? "…" : ""}`;
}

async function search(query) {
  const id = ++requestId;
  results.replaceChildren();
  if (query.length < 2) {
    status.textContent = "Enter at least two characters to search the site.";
    return;
  }
  status.textContent = "Searching…";
  try {
    const [staticResponse, postsResponse] = await Promise.all([
      fetch("search-index.json"),
      fetch(`/api/search-posts?q=${encodeURIComponent(query)}`),
    ]);
    if (!staticResponse.ok || !postsResponse.ok) throw new Error("Search is unavailable right now. Please try again.");
    const [pages, posts] = await Promise.all([staticResponse.json(), postsResponse.json()]);
    if (id !== requestId) return;
    const matches = pages.filter((page) =>
      `${page.title} ${page.text}`.toLocaleLowerCase().includes(query)
    );
    const found = new Map([...posts.results, ...matches].map((item) => [item.url, item]));
    status.textContent = found.size ? `${found.size} result${found.size === 1 ? "" : "s"} found.` : "No results found. Try another word.";
    for (const page of found.values()) {
      const article = document.createElement("article");
      article.className = "search-result";
      const heading = document.createElement("h2");
      const link = document.createElement("a");
      link.href = page.url;
      link.textContent = page.title;
      heading.append(link);
      const description = document.createElement("p");
      description.textContent = preview(page.text, query);
      article.append(heading, description);
      results.append(article);
    }
  } catch (error) {
    if (id === requestId) status.textContent = error.message;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim().toLocaleLowerCase();
  history.replaceState(null, "", query ? `?q=${encodeURIComponent(query)}` : location.pathname);
  search(query);
});
const initial = new URLSearchParams(location.search).get("q") || "";
input.value = initial;
search(initial.trim().toLocaleLowerCase());
