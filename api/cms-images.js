const { randomUUID } = require("node:crypto");
const { getSupabaseConfig, verifyAdminUser } = require("./_cms-auth");
const { BUCKET, MAX_IMAGE_BYTES, validateWebp } = require("./_cms-images");

module.exports = async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  const reply = (status, body) => response.status(status).json(body);
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });
  const config = getSupabaseConfig();
  if (!config) return reply(503, { error: "Supabase configuration missing." });
  const auth = await verifyAdminUser(request, config);
  if (!auth.ok) return reply(auth.status, { error: auth.error });

  let image;
  try {
    const input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    if (typeof input?.image !== "string" || input.image.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) {
      throw new Error("A base64-encoded WebP thumbnail no larger than 300 KB is required.");
    }
    image = Buffer.from(input.image, "base64");
    validateWebp(image);
  } catch (error) {
    return reply(400, { error: error.message || "Invalid image upload." });
  }

  const headers = {
    apikey: config.secretKey,
    ...(config.isLegacyJwt ? { authorization: `Bearer ${config.secretKey}` } : {}),
  };
  try {
    const bucketRes = await fetch(`${config.url}/storage/v1/bucket/${BUCKET}`, { headers });
    if (bucketRes.ok) {
      const bucket = await bucketRes.json();
      if (!bucket.public) {
        throw new Error("The article-thumbnails bucket must be public so readers can see article images.");
      }
    } else {
      const bucketError = await bucketRes.json();
      if (bucketRes.status !== 404 && bucketError.statusCode !== "404" && bucketError.statusCode !== 404) {
        throw new Error(`Could not access thumbnail storage: ${bucketError.message || bucketRes.status}`);
      }
      const createRes = await fetch(`${config.url}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          id: BUCKET, name: BUCKET, public: true,
          file_size_limit: MAX_IMAGE_BYTES, allowed_mime_types: ["image/webp"],
        }),
      });
      if (!createRes.ok) {
        const createError = await createRes.json();
        if (String(createError.statusCode) !== "409") {
          throw new Error(`Could not create thumbnail storage: ${createError.message || createRes.status}`);
        }
      }
    }
    const filename = `${randomUUID()}.webp`;
    const uploadRes = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${filename}`, {
      method: "POST",
      headers: { ...headers, "content-type": "image/webp", "cache-control": "31536000" },
      body: image,
    });
    if (!uploadRes.ok) {
      const error = await uploadRes.json();
      throw new Error(`Thumbnail upload failed: ${error.message || uploadRes.status}`);
    }
    return reply(200, { url: `${config.url}/storage/v1/object/public/${BUCKET}/${filename}`, bytes: image.length });
  } catch (error) {
    return reply(500, { error: error.message || "Failed to upload thumbnail." });
  }
};
