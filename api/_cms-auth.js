function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  return { url, secretKey, isLegacyJwt: secretKey.startsWith("eyJ") };
}

async function verifyAdminUser(request, config) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or invalid authorization header." };
  }
  const allowedAdmin = (process.env.ADMIN_EMAIL || process.env.COMMENT_NOTIFY_EMAIL || "enovashan@gmail.com").toLowerCase().trim();
  try {
    const res = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.secretKey, authorization: authHeader },
    });
    if (!res.ok) return { ok: false, status: 401, error: "Session expired or invalid." };
    const user = await res.json();
    if (!user?.email || user.email.toLowerCase().trim() !== allowedAdmin) {
      return { ok: false, status: 403, error: "Access denied. Only the administrator account is authorized." };
    }
    return { ok: true, user };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || "Failed to verify admin identity." };
  }
}

module.exports = { getSupabaseConfig, verifyAdminUser };
