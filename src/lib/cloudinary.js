const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");

const MAX_DIGITAL_FILE_SIZE = 200 * 1024 * 1024;
const DIGITAL_FOLDER = "fabricnow/downloads";

function getCloudinaryConfig() {
  const config = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  };

  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    const error = new Error(
      "Cloudinary storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."
    );
    error.status = 503;
    throw error;
  }

  cloudinary.config(config);
  return config;
}

function cleanOriginalName(value) {
  const name = path.basename(String(value || "").replace(/[\\/\0-\x1f\x7f]/g, "_")).trim();
  if (!name || !/\.zip$/i.test(name)) {
    const error = new Error("originalName must be a .zip filename");
    error.status = 400;
    throw error;
  }
  if (name.length <= 180) return name;
  return `${name.slice(0, 176)}${name.slice(-4)}`;
}

function createDigitalUploadSignature(originalName, existingPublicId) {
  const config = getCloudinaryConfig();
  const safeName = cleanOriginalName(originalName);
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = existingPublicId || `${DIGITAL_FOLDER}/${nanoid(18)}.zip`;
  if (!new RegExp(`^${DIGITAL_FOLDER}/[A-Za-z0-9_-]{18}\\.zip$`).test(publicId)) {
    const error = new Error("Invalid Cloudinary ZIP upload ID.");
    error.status = 400;
    throw error;
  }
  const params = {
    timestamp,
    public_id: publicId,
    type: "authenticated",
    filename_override: safeName,
    overwrite: false,
  };

  return {
    cloudName: config.cloud_name,
    apiKey: config.api_key,
    timestamp,
    signature: cloudinary.utils.api_sign_request(params, config.api_secret),
    publicId,
    type: params.type,
    filenameOverride: safeName,
  };
}

async function uploadImage(localPath) {
  getCloudinaryConfig();
  const result = await cloudinary.uploader.upload(localPath, {
    folder: "fabricnow/images",
    resource_type: "image",
    overwrite: false,
    unique_filename: true,
  });
  return { publicId: result.public_id, secureUrl: result.secure_url };
}

async function uploadRawFile(localPath, originalName) {
  getCloudinaryConfig();
  const safeName = cleanOriginalName(originalName);
  const { size } = await fs.promises.stat(localPath);
  if (size <= 0 || size > MAX_DIGITAL_FILE_SIZE) {
    const error = new Error("ZIP size must be between 1 byte and 200MB.");
    error.status = 400;
    throw error;
  }
  const publicId = `${DIGITAL_FOLDER}/${nanoid(18)}.zip`;
  const result = await cloudinary.uploader.upload_large(localPath, {
    public_id: publicId,
    resource_type: "raw",
    type: "authenticated",
    filename_override: safeName,
    overwrite: false,
    chunk_size: 20 * 1024 * 1024,
  });
  return {
    fileName: result.public_id,
    originalName: safeName,
    size: result.bytes,
    storage: "cloudinary",
    uploadedAt: new Date(),
  };
}

async function verifyDigitalUpload(publicId, size) {
  getCloudinaryConfig();
  if (!new RegExp(`^${DIGITAL_FOLDER}/[A-Za-z0-9_-]{18}\\.zip$`).test(publicId || "")) {
    const error = new Error("Invalid Cloudinary ZIP upload ID.");
    error.status = 400;
    throw error;
  }

  let asset;
  try {
    asset = await cloudinary.api.resource(publicId, {
      resource_type: "raw",
      type: "authenticated",
    });
  } catch (error) {
    if (error.http_code === 404) {
      const missing = new Error("The uploaded ZIP was not found in Cloudinary.");
      missing.status = 400;
      throw missing;
    }
    throw error;
  }

  if (
    asset.public_id !== publicId ||
    asset.resource_type !== "raw" ||
    asset.type !== "authenticated" ||
    asset.format !== "zip" ||
    Number(asset.bytes) !== Number(size) ||
    Number(asset.bytes) <= 0 ||
    Number(asset.bytes) > MAX_DIGITAL_FILE_SIZE
  ) {
    const error = new Error("The Cloudinary upload is not a valid ZIP file of the declared size.");
    error.status = 400;
    throw error;
  }

  return asset;
}

function privateDownloadUrl(publicId, expiresInSeconds = 300) {
  getCloudinaryConfig();
  return cloudinary.utils.private_download_url(publicId, "zip", {
    resource_type: "raw",
    type: "authenticated",
    attachment: true,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

module.exports = {
  MAX_DIGITAL_FILE_SIZE,
  cleanOriginalName,
  createDigitalUploadSignature,
  privateDownloadUrl,
  uploadImage,
  uploadRawFile,
  verifyDigitalUpload,
};
