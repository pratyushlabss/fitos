# Android Integration Contract

The Android client owns hardware permissions and sends normalized data to FITOS.

- Camera: CameraX with the `CAMERA` permission.
- Barcode/OCR: send decoded identifiers or OCR text with confidence and source.
- GPS: send activity points from the location provider.
- Health Connect: request only needed record permissions; historical/background
  access is permission-dependent and must be treated as revocable.
- Auth: send the Supabase access token as a bearer token to `/api/v1`.

The backend validates, deduplicates, normalizes, and stores received records; it
never assumes direct Android hardware access.
