# Lower number wins. Live Strava API is not used; strava is import-only if present.
SOURCE_PRIORITY: dict[str, int] = {
    "apple_health": 1,
    "health_connect": 2,
    "watch": 3,
    "fitos": 4,
    "fitos_manual": 5,
    "gpx": 6,
    "fit": 6,
    "native_gps": 6,
    "strava": 8,
    "other": 99,
}


def source_priority(source: str) -> int:
    return SOURCE_PRIORITY.get(source.lower(), SOURCE_PRIORITY["other"])
