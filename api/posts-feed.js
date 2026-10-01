// Public, read-only feed of recently published articles for the home page notification bell.
// No auth required: only exposes already-public fields for posts with status = "published".

function jsonResponse(response, status, value) {
  response.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=300");
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

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    return jsonResponse(response, 405, { error: "Method not allowed." });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return jsonResponse(response, 503, { error: "Supabase configuration missing." });
  }

  try {
    const res = await fetch(
      `${config.url}/rest/v1/posts?status=eq.published&select=slug,title,summary,target_page,language,published_at&order=published_at.desc&limit=10`,
      {
        headers: {
          apikey: config.secretKey,
          ...(config.isLegacyJwt ? { authorization: `Bearer ${config.secretKey}` } : {}),
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return jsonResponse(response, res.status, { error: `Failed to fetch posts feed: ${text}` });
    }

    const posts = await res.json();
    return jsonResponse(response, 200, { posts });
  } catch (error) {
    return jsonResponse(response, 500, { error: error.message || "Failed to load posts feed." });
  }
};
