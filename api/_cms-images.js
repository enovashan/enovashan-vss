const BUCKET = "article-thumbnails";
const MAX_IMAGE_BYTES = 300 * 1024;

function isThumbnailUrl(value, supabaseUrl) {
  if (typeof value !== "string") return false;
  if (!value) return true;
  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`;
  return value.startsWith(prefix) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(value.slice(prefix.length));
}

function validateWebp(buffer) {
  if (buffer.length < 30 || buffer.length > MAX_IMAGE_BYTES ||
      buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.readUInt32LE(4) !== buffer.length - 8 ||
      buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Upload a valid WebP thumbnail no larger than 300 KB.");
  }
  const chunk = buffer.toString("ascii", 12, 16);
  let width;
  let height;
  if (chunk === "VP8 " && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    width = buffer.readUInt16LE(26) & 0x3fff;
    height = buffer.readUInt16LE(28) & 0x3fff;
  } else if (chunk === "VP8L" && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === "VP8X" && !(buffer[20] & 0x02)) {
    width = buffer.readUIntLE(24, 3) + 1;
    height = buffer.readUIntLE(27, 3) + 1;
  } else {
    throw new Error("Only still WebP thumbnails are supported.");
  }
  if (width !== 1200 || height !== 675) {
    throw new Error("Thumbnails must be 1200 by 675 pixels.");
  }
}

module.exports = { BUCKET, MAX_IMAGE_BYTES, isThumbnailUrl, validateWebp };
