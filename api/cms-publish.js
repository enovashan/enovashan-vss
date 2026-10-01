const { publishPostToGitHub, unpublishPostFromGitHub } = require("./_github-publish");

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

async function fetchPostBySlug(config, slug) {
  const res = await fetch(`${config.url}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&select=*`, {
    headers: {
      apikey: config.secretKey,
      ...(config.isLegacyJwt ? { authorization: `Bearer ${config.secretKey}` } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch post: ${text}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

// POST { slug } -> commits the article's static HTML + directory card(s) to GitHub, triggering a real deploy
module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    return jsonResponse(response, 405, { error: "Method not allowed." });
  }

  const supabaseConfig = getSupabaseConfig();
  if (!supabaseConfig) {
    return jsonResponse(response, 503, { error: "Supabase configuration missing (SUPABASE_URL / SUPABASE_SECRET_KEY)." });
  }

  const auth = await verifyAdminUser(request, supabaseConfig);
  if (!auth.ok) {
    return jsonResponse(response, auth.status, { error: auth.error });
  }

  let input;
  try {
    input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch {
    return jsonResponse(response, 400, { error: "The request must contain valid JSON." });
  }

  const slug = (input?.slug || "").trim();
  if (!slug) {
    return jsonResponse(response, 400, { error: "A slug is required." });
  }

  try {
    const post = await fetchPostBySlug(supabaseConfig, slug);
    if (!post) {
      return jsonResponse(response, 404, { error: "Post not found." });
    }

    if (post.status !== "published") {
      // Pull it off the live site if it was previously published and has since been set back to draft
      await unpublishPostFromGitHub(post);
      return jsonResponse(response, 200, { published: false, message: "Saved as draft — not live on the website." });
    }

    const result = await publishPostToGitHub(post);
    return jsonResponse(response, 200, { published: true, url: result.articleUrl });
  } catch (error) {
    return jsonResponse(response, 500, { error: error.message || "Failed to publish to the live website." });
  }
};
