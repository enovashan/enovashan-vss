function jsonResponse(response, status, value) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  return response.status(status).json(value);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  return { url, secretKey, isLegacyJwt: secretKey.startsWith("eyJ") };
}

function getAllowedAdminEmail() {
  return (process.env.ADMIN_EMAIL || process.env.COMMENT_NOTIFY_EMAIL || "enovashan@gmail.com").toLowerCase().trim();
}

async function verifyAdminUser(request, config) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or invalid authorization header." };
  }
  try {
    const userResponse = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.secretKey, authorization: authHeader },
    });
    if (!userResponse.ok) {
      return { ok: false, status: 401, error: "Session expired or invalid." };
    }
    const user = await userResponse.json();
    if (!user?.email || user.email.toLowerCase().trim() !== getAllowedAdminEmail()) {
      return { ok: false, status: 403, error: "Access denied. Only the site administrator is authorized." };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 500, error: "Failed to verify admin identity." };
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

function parseBody(request) {
  try {
    const input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    return input && typeof input === "object" ? { input } : { error: "The request must contain valid JSON." };
  } catch {
    return { error: "The request must contain valid JSON." };
  }
}

module.exports = async function handler(request, response) {
  if (!["GET", "PATCH", "DELETE"].includes(request.method)) {
    return jsonResponse(response, 405, { error: "Method not allowed." });
  }
  const config = getSupabaseConfig();
  if (!config) {
    return jsonResponse(response, 503, { error: "Supabase configuration missing (SUPABASE_URL / SUPABASE_SECRET_KEY)." });
  }

  const auth = await verifyAdminUser(request, config);
  if (!auth.ok) return jsonResponse(response, auth.status, { error: auth.error });

  if (request.method === "GET") {
    try {
      const result = await supabaseRequest(
        config,
        "topic_suggestions?select=id,suggestion,language,completed,created_at,updated_at&order=created_at.desc",
      );
      if (!result.ok) {
        return jsonResponse(response, 502, { error: `Failed to load suggestions (HTTP ${result.status}). Ensure schema.sql is up to date.` });
      }
      return jsonResponse(response, 200, { suggestions: await result.json() });
    } catch {
      return jsonResponse(response, 500, { error: "Failed to query suggestions." });
    }
  }

  const id = typeof request.query?.id === "string" ? request.query.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return jsonResponse(response, 400, { error: "A valid suggestion ID is required." });
  }
  const filter = `topic_suggestions?id=eq.${encodeURIComponent(id)}`;

  if (request.method === "DELETE") {
    try {
      const result = await supabaseRequest(config, filter, {
        method: "DELETE",
        headers: { prefer: "return=representation" },
      });
      if (!result.ok) {
        return jsonResponse(response, 502, { error: `Failed to delete suggestion (HTTP ${result.status}).` });
      }
      const [deleted] = await result.json();
      if (!deleted) return jsonResponse(response, 404, { error: "Suggestion not found." });
      return jsonResponse(response, 200, { success: true });
    } catch {
      return jsonResponse(response, 500, { error: "Failed to delete suggestion." });
    }
  }

  const { input, error } = parseBody(request);
  if (error) return jsonResponse(response, 400, { error });
  const payload = {};
  if (Object.hasOwn(input, "completed")) {
    if (typeof input.completed !== "boolean") {
      return jsonResponse(response, 400, { error: "Completion status must be true or false." });
    }
    payload.completed = input.completed;
  }
  if (Object.hasOwn(input, "suggestion") || Object.hasOwn(input, "language")) {
    const suggestion = typeof input.suggestion === "string"
      ? input.suggestion.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
      : "";
    if (!suggestion || suggestion.length > 500 || !["en", "ur", "ar"].includes(input.language)) {
      return jsonResponse(response, 400, { error: "Enter a suggestion of 1 to 500 characters and choose a supported language." });
    }
    payload.suggestion = suggestion;
    payload.language = input.language;
    payload.dedupe_key = suggestion.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
  if (Object.keys(payload).length === 0) {
    return jsonResponse(response, 400, { error: "No suggestion changes were provided." });
  }
  payload.updated_at = new Date().toISOString();

  try {
    const result = await supabaseRequest(config, filter, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      const text = await result.text();
      if (result.status === 409 || text.includes("topic_suggestions_dedupe_key_key")) {
        return jsonResponse(response, 409, { error: "Another suggestion already has the same text." });
      }
      return jsonResponse(response, 502, { error: `Failed to update suggestion: ${text}` });
    }
    const [suggestion] = await result.json();
    if (!suggestion) return jsonResponse(response, 404, { error: "Suggestion not found." });
    return jsonResponse(response, 200, { suggestion });
  } catch {
    return jsonResponse(response, 500, { error: "Failed to update suggestion." });
  }
};
