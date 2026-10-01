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

module.exports = async function handler(request, response) {
  const config = getSupabaseConfig();
  if (!config) {
    return jsonResponse(response, 503, { error: "Supabase configuration missing (SUPABASE_URL / SUPABASE_SECRET_KEY)." });
  }

  const allowedAdmin = getAllowedAdminEmail();

  // GET: verify existing session token
  if (request.method === "GET") {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(response, 401, { error: "Authorization header required." });
    }
    const token = authHeader.slice(7).trim();

    try {
      const userRes = await fetch(`${config.url}/auth/v1/user`, {
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${token}`,
        },
      });

      if (!userRes.ok) {
        return jsonResponse(response, 401, { error: "Session expired or invalid. Please sign in again." });
      }

      const user = await userRes.json();
      if (!user?.email || user.email.toLowerCase().trim() !== allowedAdmin) {
        return jsonResponse(response, 403, { error: "Access denied. Only the site administrator is authorized." });
      }

      return jsonResponse(response, 200, {
        authenticated: true,
        user: { id: user.id, email: user.email },
      });
    } catch (error) {
      return jsonResponse(response, 500, { error: error.message || "Authentication check failed." });
    }
  }

  // POST: sign in with email and password
  if (request.method === "POST") {
    let input;
    try {
      input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      return jsonResponse(response, 400, { error: "The request must contain valid JSON." });
    }

    const { email, password } = input || {};
    if (!email || !password) {
      return jsonResponse(response, 400, { error: "Email and password are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail !== allowedAdmin) {
      return jsonResponse(response, 403, { error: "Access denied. Only the administrator account is authorized to access the CMS." });
    }

    try {
      const authRes = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: config.secretKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      const authData = await authRes.json();

      if (!authRes.ok) {
        return jsonResponse(response, 401, {
          error: authData.error_description || authData.msg || authData.message || "Invalid credentials.",
        });
      }

      return jsonResponse(response, 200, {
        token: authData.access_token,
        user: {
          id: authData.user?.id,
          email: authData.user?.email,
        },
      });
    } catch (error) {
      return jsonResponse(response, 500, { error: error.message || "Failed to authenticate with Supabase." });
    }
  }

  return jsonResponse(response, 405, { error: "Method not allowed." });
};
