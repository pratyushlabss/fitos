from uuid import UUID

from supabase import Client


class SupabaseAuthProvider:
    """Verifies Supabase access tokens without exposing auth details to domain code."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def verify_access_token(self, token: str) -> UUID:
        try:
            response = self._client.auth.get_user(token)
            user_id = UUID(str(response.user.id))
        except (AttributeError, TypeError, ValueError) as exc:
            raise ValueError("invalid_access_token") from exc
        return user_id
