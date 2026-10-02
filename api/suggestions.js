const { createHmac } = require("node:crypto");

const SUGGESTION_MAX_LENGTH = 500;

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

function cleanSuggestion(value) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function getDedupeKey(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function storageError(status, operation) {
  if (status === 401 || status === 403) {
    return `Supabase rejected the server key while ${operation} (HTTP ${status}). Check that the secret key and project URL belong to the same project.`;
  }
  if (status === 404) {
    return `Supabase could not find the ${operation} (HTTP 404). Check that schema.sql ran in the project named by SUPABASE_URL.`;
  }
  return `Supabase failed while ${operation} (HTTP ${status}).`;
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(response, 405, { error: "Method not allowed." });
  }
  if (!isSameOrigin(request)) {
    return jsonResponse(response, 403, { error: "Request origin is not allowed." });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return jsonResponse(response, 503, { error: "Suggestion storage is not configured yet." });
  }

  try {
    if (request.method === "GET") {
      const result = await supabaseRequest(
        config,
        "topic_suggestions?select=id,suggestion,language,completed,created_at&order=created_at.desc",
      );
      if (!result.ok) {
        return jsonResponse(response, 502, { error: storageError(result.status, "loading suggestions") });
      }
      return jsonResponse(response, 200, { suggestions: await result.json() });
    }

    let input;
    try {
      input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      return jsonResponse(response, 400, { error: "The suggestion request must contain valid JSON." });
    }
    if (!input || typeof input !== "object") {
      return jsonResponse(response, 400, { error: "The suggestion request must contain valid JSON." });
    }
    if (typeof input.website === "string" && input.website.trim()) {
      return jsonResponse(response, 201, { accepted: true });
    }

    const suggestion = typeof input.suggestion === "string" ? cleanSuggestion(input.suggestion) : "";
    const language = input.language;
    if (!suggestion || suggestion.length > SUGGESTION_MAX_LENGTH) {
      return jsonResponse(response, 400, { error: `Please enter a suggestion of 1 to ${SUGGESTION_MAX_LENGTH} characters.` });
    }
    if (!["en", "ur", "ar"].includes(language)) {
      return jsonResponse(response, 400, { error: "Please choose English, Urdu, or Arabic." });
    }

    const clientAddress = request.headers["x-vercel-forwarded-for"]
      || request.headers["x-forwarded-for"]?.split(",")[0].trim()
      || "unknown";
    const fingerprint = createHmac("sha256", config.secretKey).update(clientAddress).digest("hex");
    const rateLimit = await supabaseRequest(config, "rpc/consume_topic_suggestion_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_fingerprint: fingerprint }),
    });
    if (!rateLimit.ok) {
      return jsonResponse(response, 502, { error: storageError(rateLimit.status, "checking suggestion rate limits") });
    }
    if (await rateLimit.json() !== true) {
      return jsonResponse(response, 429, { error: "Please wait before sending another suggestion." });
    }

    const dedupeKey = getDedupeKey(suggestion);
    const result = await supabaseRequest(config, "topic_suggestions?on_conflict=dedupe_key", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ suggestion, language, dedupe_key: dedupeKey }),
    });
    if (!result.ok) {
      return jsonResponse(response, 502, { error: storageError(result.status, "saving the suggestion") });
    }
    const [savedSuggestion] = await result.json();
    if (savedSuggestion) {
      return jsonResponse(response, 201, { suggestion: savedSuggestion, alreadyExists: false });
    }

    const query = new URLSearchParams({
      select: "id,suggestion,language,completed,created_at",
      dedupe_key: `eq.${dedupeKey}`,
      limit: "1",
    });
    const existingResult = await supabaseRequest(config, `topic_suggestions?${query}`);
    if (!existingResult.ok) {
      return jsonResponse(response, 502, { error: storageError(existingResult.status, "checking for a duplicate suggestion") });
    }
    const [existingSuggestion] = await existingResult.json();
    if (!existingSuggestion) {
      return jsonResponse(response, 502, { error: "The existing suggestion could not be retrieved." });
    }
    return jsonResponse(response, 200, { suggestion: existingSuggestion, alreadyExists: true });
  } catch {
    return jsonResponse(response, 500, { error: "The suggestions service encountered an error." });
  }
};
