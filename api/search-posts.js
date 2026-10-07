module.exports = async function handler(request, response) {
  response.setHeader("cache-control", "public, max-age=60");
  response.setHeader("x-content-type-options", "nosniff");
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed." });
  }
  const query = typeof request.query.q === "string" ? request.query.q.trim().toLocaleLowerCase() : "";
  if (query.length < 2 || query.length > 100) {
    return response.status(400).json({ error: "Enter between 2 and 100 characters." });
  }
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return response.status(503).json({ error: "Search is not configured." });
  }
  try {
    const res = await fetch(`${url}/rest/v1/posts?status=eq.published&select=slug,title,summary,content_markdown&order=published_at.desc`, {
      headers: {
        apikey: key,
        ...(key.startsWith("eyJ") ? { authorization: "Bearer " + key } : {}),
      },
    });
    if (!res.ok) {
      return response.status(502).json({ error: `Post search failed (HTTP ${res.status}).` });
    }
    const posts = await res.json();
    const results = posts.filter((post) =>
      [post.title, post.summary, post.content_markdown].some((value) => value?.toLocaleLowerCase().includes(query))
    ).slice(0, 30).map((post) => ({
      url: `/${post.slug}`,
      title: post.title,
      text: post.summary || post.content_markdown?.slice(0, 220) || "",
    }));
    return response.status(200).json({ results });
  } catch (error) {
    return response.status(502).json({ error: `Post search unavailable: ${error.message}` });
  }
};
