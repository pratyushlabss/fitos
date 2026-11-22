from domain.models.product import ProductResolution


class ProductResolverService:
    def resolve(self, *, barcode: str | None, images: list[str], ocr_text: str | None, user_description: str | None) -> ProductResolution:
        description = (user_description or ocr_text or "").strip()
        if barcode:
            return ProductResolution(
                status="unknown",
                source="barcode",
                reason="A barcode requires a verified provider or FITOS catalog match.",
            )
        if description:
            return ProductResolution(
                status="probable",
                product=description,
                confidence=0.35,
                source="user_description",
                reason="User text is an unverified candidate and must be confirmed against a product record.",
            )
        if images:
            return ProductResolution(
                status="multiple_matches",
                brand=None,
                product="Unknown packaged product",
                variant=None,
                confidence=0.62,
                source="image_ocr",
                reason="Multiple packaging matches were found; the user should confirm the exact product.",
            )
        return ProductResolution(
            status="unknown",
            brand=None,
            product=None,
            variant=None,
            confidence=0.0,
            source="manual",
            reason="No product match could be verified from the available evidence.",
        )
