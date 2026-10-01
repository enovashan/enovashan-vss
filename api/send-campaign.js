const RESEND_FROM = process.env.RESEND_FROM || "Enovashan <hello@enovashan.com>";
const REPLY_TO = process.env.RESEND_REPLY_TO || "enovashan@gmail.com";
const BATCH_SIZE = 90; // stay under Resend's 100-per-batch-call limit

function jsonResponse(response, status, value) {
  response.setHeader("cache-control", "no-store");
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

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

function buildEmailHtml({ heading, summary, url }, unsubscribeUrl) {
  return `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;">
      <p style="text-transform:uppercase;letter-spacing:0.1em;font-size:12px;color:#888;">New on Enovashan</p>
      <h1 style="font-size:28px;line-height:1.2;margin:0.4em 0;">${heading}</h1>
      <p style="font-size:16px;line-height:1.6;color:#333;">${summary}</p>
      <p><a href="${url}" style="display:inline-block;margin-top:1em;font-weight:bold;">Read the full piece &rarr;</a></p>
      <hr style="margin:2rem 0;border:none;border-top:1px solid #ddd;" />
      <p style="font-size:12px;color:#999;">
        You're receiving this because you subscribed to the Enovashan dispatch.
        <a href="${unsubscribeUrl}">Unsubscribe</a>.
      </p>
    </div>
  `;
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return jsonResponse(response, 405, { error: "Method not allowed." });
    }

    const config = getSupabaseConfig();
    if (!config) {
      return jsonResponse(response, 503, { error: "Subscriber storage is not configured yet." });
    }

    const secret = process.env.CAMPAIGN_SECRET;
    const hasSecret = Boolean(secret && request.headers["x-campaign-secret"] === secret);
    let hasAdminAuth = false;

    if (!hasSecret) {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        try {
          const authCheck = await fetch(`${config.url}/auth/v1/user`, {
            headers: {
              apikey: config.secretKey,
              authorization: `Bearer ${token}`,
            },
          });
          if (authCheck.ok) {
            const user = await authCheck.json();
            const allowedAdmin = (process.env.ADMIN_EMAIL || process.env.COMMENT_NOTIFY_EMAIL || "enovashan@gmail.com").toLowerCase().trim();
            if (user && user.email && user.email.toLowerCase().trim() === allowedAdmin) {
              hasAdminAuth = true;
            }
          }
        } catch {
          // Token verification failed
        }
      }
    }

    if (!hasSecret && !hasAdminAuth) {
      return jsonResponse(response, 401, { error: "Not authorized." });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return jsonResponse(response, 503, { error: "RESEND_API_KEY is not configured." });
    }

    let input;
    try {
      input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      return jsonResponse(response, 400, { error: "The request must contain valid JSON." });
    }
    const { heading, summary, url } = input || {};
    if (!heading || !summary || !url) {
      return jsonResponse(response, 400, { error: "heading, summary, and url are required." });
    }

    const query = new URLSearchParams({
      select: "email,unsubscribe_token",
      confirmed: "eq.true",
      unsubscribed_at: "is.null",
    });
    const subscribersResult = await supabaseRequest(config, `subscribers?${query}`);
    if (!subscribersResult.ok) {
      return jsonResponse(response, 502, { error: "Could not load the subscriber list." });
    }
    const subscribers = await subscribersResult.json();
    if (subscribers.length === 0) {
      return jsonResponse(response, 200, { sent: 0, message: "No confirmed subscribers to email." });
    }

    const origin = process.env.SITE_URL || "https://www.enovashan.com";
    const emails = subscribers.map((subscriber) => ({
      from: RESEND_FROM,
      to: subscriber.email,
      reply_to: REPLY_TO,
      subject: `New on Enovashan: ${heading}`,
      html: buildEmailHtml(
        { heading, summary, url },
        `${origin}/api/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}`
      ),
    }));

    let sent = 0;
    for (const batch of chunk(emails, BATCH_SIZE)) {
      const batchResult = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      if (batchResult.ok) sent += batch.length;
    }

    return jsonResponse(response, 200, { sent, total: emails.length });
  } catch {
    return jsonResponse(response, 500, { error: "The campaign service encountered an error." });
  }
};
