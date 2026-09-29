const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_FROM = process.env.RESEND_FROM || "Enovashan <hello@enovashan.com>";
const REPLY_TO = process.env.RESEND_REPLY_TO || "enovashan@gmail.com";

function jsonResponse(response, status, value) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  return response.status(status).json(value);
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

async function sendWelcomeEmail(email, unsubscribeToken) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const origin = process.env.SITE_URL || "https://www.enovashan.com";
  const unsubscribeUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: email,
      reply_to: REPLY_TO,
      subject: "You're on the list — Enovashan",
      html: `
        <p>Thank you for joining the Enovashan dispatch.</p>
        <p>You'll hear from us when a new story, note, or update is worth your time. No hype, no clutter.</p>
        <p style="margin-top:2rem;font-size:12px;color:#888;">
          Didn't sign up? <a href="${unsubscribeUrl}">Unsubscribe</a>.
        </p>
      `,
    }),
  }).catch(() => {});
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
    if (request.method !== "POST") {
      return jsonResponse(response, 405, { error: "Method not allowed." });
    }
    if (!isSameOrigin(request)) {
      return jsonResponse(response, 403, { error: "Request origin is not allowed." });
    }

    const config = getSupabaseConfig();
    if (!config) {
      return jsonResponse(response, 503, { error: "Newsletter storage is not configured yet." });
    }

    let input;
    try {
      input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      return jsonResponse(response, 400, { error: "The request must contain valid JSON." });
    }
    if (!input || typeof input !== "object") {
      return jsonResponse(response, 400, { error: "The request must contain valid JSON." });
    }

    // Honeypot: bots fill hidden fields, humans don't.
    if (typeof input.website === "string" && input.website.trim()) {
      return jsonResponse(response, 201, { accepted: true });
    }

    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return jsonResponse(response, 400, { error: "Please enter a valid email address." });
    }

    const result = await supabaseRequest(config, "subscribers", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ email }),
    });
    if (!result.ok) {
      return jsonResponse(response, 502, { error: storageError(result.status, "saving the subscription") });
    }
    const rows = await result.json();
    const subscriber = rows[0];

    if (subscriber) {
      await sendWelcomeEmail(email, subscriber.unsubscribe_token);
    }

    return jsonResponse(response, 201, { subscribed: true });
  } catch {
    return jsonResponse(response, 500, { error: "The newsletter service encountered an error." });
  }
};
