// Profile avatar upload through Blocks Storage (the tenant's "Default"
// Azure configuration). Flow: downscale in-canvas -> presigned URL from
// blocks-data -> provider-direct PUT. The fileId is what gets persisted;
// display URLs are resolved fresh (they are short-lived signed URLs).
import { blocksClient } from "./client";
import type { TranslationKey } from "../i18n/dictionary";

// Phone photos routinely run 8-15 MB; refusing them here was the reason
// uploads "did nothing" -- no network call, just a missed toast. We ship a
// 256px PNG regardless of the input's size, so this is a sanity cap only.
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const AVATAR_EDGE = 256;

export type PreparedAvatar = { blob: Blob; name: string };

/** Center-crop the chosen image to a 256px PNG so avatars stay tiny and uniform. */
export async function prepareAvatarImage(file: File): Promise<PreparedAvatar> {
  // An empty MIME type (some pickers/older phones) still gets a chance: let
  // the decoder decide instead of rejecting on the reported type alone.
  if (file.type !== "" && !file.type.startsWith("image/")) throw new Error("avatar.notImage" satisfies TranslationKey);
  if (file.size > MAX_INPUT_BYTES) throw new Error("avatar.tooLarge" satisfies TranslationKey);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // createImageBitmap refuses some inputs its <img> decoder accepts (and
    // vice versa) -- retry through the element path before giving up.
    bitmap = await decodeViaImageElement(file).catch(() => {
      console.error("[avatar] undecodable image:", file.type || "(no type)", `${(file.size / 1024 / 1024).toFixed(1)} MB`);
      throw new Error("avatar.processFailed" satisfies TranslationKey);
    });
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("avatar.processFailed" satisfies TranslationKey);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("avatar.processFailed" satisfies TranslationKey);
  return { blob, name: `avatar-${Date.now()}.png` };
}

/** Fallback decode: <img>.decode() takes a different codec path than createImageBitmap. */
async function decodeViaImageElement(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type PresignResponse = { uploadUrl?: unknown; fileId?: unknown; isSuccess?: unknown; errors?: unknown };

/**
 * Create the file object and fill its bytes. Private access: display goes
 * through freshly-signed download URLs, never through a guessed blob URL.
 */
export async function uploadAvatarBlob(prepared: PreparedAvatar): Promise<string> {
  const presign = (await blocksClient.data.files.presignedUploadUrl({
    name: prepared.name,
    configurationName: "Default",
    accessModifier: "Private",
    tags: "avatar"
  })) as PresignResponse | null | undefined;
  if (!presign || typeof presign !== "object") {
    throw new Error("avatar.uploadFailed" satisfies TranslationKey);
  }
  if (presign.isSuccess === false) {
    throw new Error(`avatar.uploadFailed: ${JSON.stringify(presign.errors ?? {})}`);
  }
  const uploadUrl = typeof presign.uploadUrl === "string" ? presign.uploadUrl : "";
  const fileId = typeof presign.fileId === "string" ? presign.fileId : "";
  if (!uploadUrl || !fileId) {
    throw new Error("avatar.uploadFailed" satisfies TranslationKey);
  }
  // Provider-direct: this PUT carries no Blocks auth headers by design.
  await blocksClient.data.files.uploadToUrl({ url: uploadUrl, body: prepared.blob, contentType: "image/png" });
  return fileId;
}

/** Fresh signed download URL for an <img src> -- they expire, so never cache long. */
export async function avatarDownloadUrl(fileId: string): Promise<string> {
  const response = await blocksClient.data.files.get(fileId, { configurationName: "Default" });
  const url = findDownloadUrl(response, 0);
  if (!url) throw new Error("avatar.urlMissing" satisfies TranslationKey);
  return url;
}

/** Most files.* calls come back untyped -- walk for a URL-shaped field. */
function findDownloadUrl(value: unknown, depth: number): string | undefined {
  if (depth > 6) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => findDownloadUrl(entry, depth + 1)).find(Boolean);
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const isUrl = typeof entry === "string" && /^https?:\/\//i.test(entry);
      if (isUrl && !/^(name|fileName)$/i.test(key)) return entry;
      const nested = findDownloadUrl(entry, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}
