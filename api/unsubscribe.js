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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function htmlPage(message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>Enovashan</title></head>
  <body style="font-family:sans-serif;max-width:480px;margin:4rem auto;text-align:center;">
    <p>${message}</p>
    <p><a href="/">Return to Enovashan</a></p>
  </body></html>`;
}

module.exports = async function handler(request, response) {
  response.setHeader("cache-control", "no-store");

  if (request.method !== "GET") {
    return response.status(405).send(htmlPage("Method not allowed."));
  }

  const token = typeof request.query.token === "string" ? request.query.token : "";
  if (!UUID_PATTERN.test(token)) {
    return response.status(400).send(htmlPage("This unsubscribe link is invalid."));
  }

  const config = getSupabaseConfig();
  if (!config) {
    return response.status(503).send(htmlPage("Unsubscribe is not available right now."));
  }

  try {
    const result = await supabaseRequest(config, `subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ unsubscribed_at: new Date().toISOString(), confirmed: false }),
    });
    if (!result.ok) {
      return response.status(502).send(htmlPage("We couldn't process your unsubscribe request. Please try again later."));
    }
    return response.status(200).send(htmlPage("You've been unsubscribed. You won't receive further emails from Enovashan."));
  } catch {
    return response.status(500).send(htmlPage("Something went wrong. Please try again later."));
  }
};
