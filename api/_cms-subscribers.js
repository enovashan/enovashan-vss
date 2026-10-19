const { getSupabaseConfig, verifyAdminUser } = require("./_cms-auth");

module.exports = async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  const reply = (status, body) => response.status(status).json(body);
  if (request.method !== "GET") return reply(405, { error: "Method not allowed." });
  const config = getSupabaseConfig();
  if (!config) return reply(503, { error: "Subscriber storage is not configured." });
  const auth = await verifyAdminUser(request, config);
  if (!auth.ok) return reply(auth.status, { error: auth.error });

  const summary = request.query?.summary === "true";
  const status = request.query?.status || "active";
  if (!["active", "unsubscribed"].includes(status)) {
    return reply(400, { error: "Status must be active or unsubscribed." });
  }
  const unsubscribed = status === "unsubscribed";
  const page = request.query?.page === undefined ? 1 : Number(request.query.page);
  const pageSize = 50;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(page * pageSize)) {
    return reply(400, { error: "Page must be a positive integer." });
  }
  const query = new URLSearchParams({
    select: summary ? "id" : unsubscribed ? "email,created_at,unsubscribed_at" : "email,created_at",
    ...(!unsubscribed ? { confirmed: "eq.true" } : {}),
    unsubscribed_at: unsubscribed ? "not.is.null" : "is.null",
    order: unsubscribed ? "unsubscribed_at.desc,id.desc" : "created_at.desc,id.desc",
    limit: summary ? "0" : String(pageSize),
    offset: summary ? "0" : String((page - 1) * pageSize),
  });
  try {
    const res = await fetch(`${config.url}/rest/v1/subscribers?${query}`, {
      headers: {
        apikey: config.secretKey,
        ...(config.isLegacyJwt ? { authorization: `Bearer ${config.secretKey}` } : {}),
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`Could not load subscribers (HTTP ${res.status}).`);
    const count = res.headers.get("content-range")?.split("/")[1];
    if (!count || !/^\d+$/.test(count) || !Number.isSafeInteger(Number(count))) {
      throw new Error("Subscriber storage did not return a valid total.");
    }
    const total = Number(count);
    const subscribers = await res.json();
    if (!Array.isArray(subscribers)) throw new Error("Subscriber storage returned an invalid list.");
    return reply(200, { total, subscribers: summary ? [] : subscribers, page, pageSize });
  } catch (error) {
    return reply(502, { error: error.message || "Could not load subscribers." });
  }
};
