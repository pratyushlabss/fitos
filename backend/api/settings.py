from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    anthropic_vision_model: str = "claude-3-5-sonnet-20241022"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    allow_development_identity: bool = False
    open_food_facts_user_agent: str = "FitOS/0.1"
    usda_fdc_api_key: str = ""


settings = Settings()
