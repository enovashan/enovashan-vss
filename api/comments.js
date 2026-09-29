const { createHmac } = require("node:crypto");

const ARTICLE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;
const NAME_MAX_LENGTH = 60;
const COMMENT_MAX_LENGTH = 2000;

function jsonResponse(response, status, value) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  return response.status(status).json(value);
}

function cleanText(value) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function getConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  return {
    url,
    secretKey,
    isLegacyJwt: secretKey.startsWith("eyJ"),
  };
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

function isSameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse(response, 405, { error: "Method not allowed." });
    }
    if (!isSameOrigin(request)) {
      return jsonResponse(response, 403, { error: "Request origin is not allowed." });
    }

    const config = getConfig();
    if (!config) {
      return jsonResponse(response, 503, { error: "Comment storage is not configured yet." });
    }

    if (request.method === "GET") {
      const slug = typeof request.query.slug === "string" ? request.query.slug : "";
      if (!ARTICLE_SLUG_PATTERN.test(slug)) {
        return jsonResponse(response, 400, { error: "A valid article slug is required." });
      }

      const query = new URLSearchParams({
        select: "id,article_slug,display_name,body,created_at",
        article_slug: `eq.${slug}`,
        order: "created_at.asc",
        limit: "100",
      });
      const result = await supabaseRequest(config, `comments?${query}`);
      if (!result.ok) return jsonResponse(response, 502, { error: "Comments could not be loaded." });
      return jsonResponse(response, 200, { comments: await result.json() });
    }

    let input;
    try {
      input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      return jsonResponse(response, 400, { error: "The comment request must contain valid JSON." });
    }
    if (!input || typeof input !== "object") {
      return jsonResponse(response, 400, { error: "The comment request must contain valid JSON." });
    }

    if (typeof input.website === "string" && input.website.trim()) {
      return jsonResponse(response, 201, { accepted: true });
    }

    const slug = typeof input.slug === "string" ? input.slug : "";
    const displayName = typeof input.name === "string" ? cleanText(input.name) : "";
    const body = typeof input.body === "string" ? cleanText(input.body) : "";
    if (!ARTICLE_SLUG_PATTERN.test(slug)) {
      return jsonResponse(response, 400, { error: "A valid article slug is required." });
    }
    if (displayName.length < 1 || displayName.length > NAME_MAX_LENGTH) {
      return jsonResponse(response, 400, { error: `Name must be between 1 and ${NAME_MAX_LENGTH} characters.` });
    }
    if (body.length < 1 || body.length > COMMENT_MAX_LENGTH) {
      return jsonResponse(response, 400, { error: `Comment must be between 1 and ${COMMENT_MAX_LENGTH} characters.` });
    }

    const clientAddress = request.headers["x-vercel-forwarded-for"]
      || request.headers["x-forwarded-for"]?.split(",")[0].trim()
      || "unknown";
    const fingerprint = createHmac("sha256", config.secretKey).update(clientAddress).digest("hex");
    const rateLimit = await supabaseRequest(config, "rpc/consume_comment_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_fingerprint: fingerprint }),
    });
    if (!rateLimit.ok) {
      return jsonResponse(response, 502, { error: "Comment protection is temporarily unavailable." });
    }
    if (await rateLimit.json() !== true) {
      return jsonResponse(response, 429, { error: "Please wait before posting another comment." });
    }

    const result = await supabaseRequest(config, "comments", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ article_slug: slug, display_name: displayName, body }),
    });
    if (!result.ok) {
      return jsonResponse(response, 502, { error: "Your comment could not be saved. Please try again." });
    }
    const [comment] = await result.json();
    return jsonResponse(response, 201, { comment });
  } catch {
    return jsonResponse(response, 500, { error: "The comment service encountered an error." });
  }
};
