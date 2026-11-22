from enum import StrEnum


class BarcodeType(StrEnum):
    EAN = "ean"
    UPC = "upc"
    GTIN = "gtin"


class BarcodeError(ValueError):
    pass


def normalize_barcode(value: str) -> tuple[str, BarcodeType]:
    digits = "".join(value.split())
    if not digits.isdigit():
        raise BarcodeError("invalid_barcode_format")
    if len(digits) == 12:
        barcode_type = BarcodeType.UPC
    elif len(digits) == 13:
        barcode_type = BarcodeType.EAN
    elif len(digits) in {8, 14}:
        barcode_type = BarcodeType.EAN if len(digits) == 8 else BarcodeType.GTIN
    else:
        raise BarcodeError("unsupported_barcode_length")

    if not _valid_checksum(digits):
        raise BarcodeError("invalid_barcode_checksum")
    return digits, barcode_type


def _valid_checksum(digits: str) -> bool:
    check_digit = int(digits[-1])
    total = 0
    for index, character in enumerate(reversed(digits[:-1])):
        total += int(character) * (3 if index % 2 == 0 else 1)
    return (10 - total % 10) % 10 == check_digit
