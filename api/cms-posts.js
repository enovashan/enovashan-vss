function jsonResponse(response, status, value) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  return response.status(status).json(value);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  return {
    url,
    secretKey,
    isLegacyJwt: secretKey.startsWith("eyJ"),
  };
}

function getAllowedAdminEmail() {
  return (process.env.ADMIN_EMAIL || process.env.COMMENT_NOTIFY_EMAIL || "enovashan@gmail.com").toLowerCase().trim();
}

async function verifyAdminUser(request, config) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or invalid authorization header." };
  }

  const token = authHeader.slice(7).trim();
  const allowedAdmin = getAllowedAdminEmail();

  try {
    const userRes = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${token}`,
      },
    });

    if (!userRes.ok) {
      return { ok: false, status: 401, error: "Session expired or invalid." };
    }

    const user = await userRes.json();
    if (!user?.email || user.email.toLowerCase().trim() !== allowedAdmin) {
      return { ok: false, status: 403, error: "Access denied. Only the administrator account is authorized." };
    }

    return { ok: true, user };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || "Failed to verify admin identity." };
  }
}

async function supabaseRequest(config, path, options = {}) {
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.secretKey,
      ...(config.isLegacyJwt ? { authorization: `Bearer ${config.secretKey}` } : {}),
      "content-type": "application/json",
      ...options.headers,
    },
  });
}

function sanitizeSlug(value) {
  if (!value) return "";
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

module.exports = async function handler(request, response) {
  const config = getSupabaseConfig();
  if (!config) {
    return jsonResponse(response, 503, { error: "Supabase configuration missing (SUPABASE_URL / SUPABASE_SECRET_KEY)." });
  }

  const auth = await verifyAdminUser(request, config);
  if (!auth.ok) {
    return jsonResponse(response, auth.status, { error: auth.error });
  }

  // GET: list all posts
  if (request.method === "GET") {
    try {
      const res = await supabaseRequest(config, "posts?select=*&order=created_at.desc");
      if (!res.ok) {
        const text = await res.text();
        return jsonResponse(response, res.status, { error: `Failed to fetch posts: ${text}` });
      }
      const posts = await res.json();
      return jsonResponse(response, 200, { posts });
    } catch (error) {
      return jsonResponse(response, 500, { error: error.message || "Failed to query posts." });
    }
  }

  // POST: create or update post
  if (request.method === "POST") {
    let input;
    try {
      input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      return jsonResponse(response, 400, { error: "The request must contain valid JSON." });
    }

    const {
      title,
      summary,
      content_markdown,
      content_html,
      category = "",
      read_time = "",
      target_page = "stories",
      language = "en",
      status = "published",
      featured_on_home = false,
      published_at,
    } = input || {};

    const slug = sanitizeSlug(input?.slug || title);

    if (!slug) {
      return jsonResponse(response, 400, { error: "A valid slug is required." });
    }
    if (!title || !title.trim()) {
      return jsonResponse(response, 400, { error: "Post title is required." });
    }

    const payload = {
      slug,
      title: title.trim(),
      summary: (summary || "").trim(),
      content_markdown: content_markdown || "",
      content_html: content_html || "",
      category: category.trim(),
      read_time: read_time.trim(),
      target_page,
      language: ["en", "ur", "ar"].includes(language) ? language : "en",
      status: status === "draft" ? "draft" : "published",
      featured_on_home: Boolean(featured_on_home),
      published_at: published_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const res = await supabaseRequest(config, "posts?on_conflict=slug", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        return jsonResponse(response, res.status, { error: `Failed to save post: ${text}` });
      }

      const saved = await res.json();
      return jsonResponse(response, 200, { post: Array.isArray(saved) ? saved[0] : saved });
    } catch (error) {
      return jsonResponse(response, 500, { error: error.message || "Failed to save post." });
    }
  }

  // DELETE: remove post by slug
  if (request.method === "DELETE") {
    const slug = sanitizeSlug(request.query?.slug);
    if (!slug) {
      return jsonResponse(response, 400, { error: "Slug parameter is required." });
    }

    try {
      const res = await supabaseRequest(config, `posts?slug=eq.${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text();
        return jsonResponse(response, res.status, { error: `Failed to delete post: ${text}` });
      }
      return jsonResponse(response, 200, { success: true, slug });
    } catch (error) {
      return jsonResponse(response, 500, { error: error.message || "Failed to delete post." });
    }
  }

  return jsonResponse(response, 405, { error: "Method not allowed." });
};
