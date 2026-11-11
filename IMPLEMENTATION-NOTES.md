# Hosted Paystack checkout and sticker seed fixes

- Order, Premium subscription, and API subscription checkout endpoints now return Paystack's hosted `authorization_url` rather than an Inline `access_code`.
- Existing Paystack transaction initialization, server-side reference storage, transaction verification, webhook routing, subscription activation/renewal/cancellation, and private paid-order download checks are retained.
- Sticker ZIP generation now preflights every source file, fails on archive warnings/errors, waits for the output stream to close before upload, cleans temporary files on all failure paths, and avoids `NaN KB` output when a storage provider omits a numeric byte count.
- API credits remain tied to verified API subscription allowances; this project does not contain a separate credit top-up endpoint.
- Set secrets using deployment environment variables. `.env` and service-account credentials are intentionally not included in this archive.
