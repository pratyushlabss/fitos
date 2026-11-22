# iOS Integration Contract

The iOS client owns hardware permissions and sends normalized data to FITOS.

- Camera: AVFoundation with `NSCameraUsageDescription`.
- Barcode/OCR: Apple Vision results may be sent as barcode, OCR text, confidence,
  and source; server-side processing remains optional.
- GPS: Core Location supplies validated activity points.
- HealthKit: request only required read/write permissions with the HealthKit
  capability, `NSHealthShareUsageDescription`, and
  `NSHealthUpdateUsageDescription`.
- Auth: send the Supabase access token as a bearer token to `/api/v1`.

The backend must not assume it can access iPhone hardware or HealthKit directly.
