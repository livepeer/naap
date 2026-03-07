"""Configuration module -- loads from environment variables with validation and defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ProxyConfig:
    """Immutable proxy configuration loaded from environment variables."""

    provider: str
    api_key: Optional[str] = None
    model_id: Optional[str] = None
    endpoint_url: Optional[str] = None
    port: int = 8080


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


def load_config() -> ProxyConfig:
    """Load configuration from environment variables.

    Raises ConfigError if required variables are missing or validation fails.
    """
    provider = os.environ.get("PROVIDER")
    if not provider:
        raise ConfigError("Missing required environment variable: PROVIDER")

    api_key = os.environ.get("API_KEY")
    model_id = os.environ.get("MODEL_ID")
    endpoint_url = os.environ.get("ENDPOINT_URL")
    port = int(os.environ.get("PORT", "8080"))

    # Validate provider-specific requirements
    if provider in ("fal-ai", "replicate", "runpod"):
        missing = []
        if not api_key:
            missing.append("API_KEY")
        if not model_id:
            missing.append("MODEL_ID")
        if missing:
            raise ConfigError(
                f"Provider '{provider}' requires: {', '.join(missing)}"
            )

    if provider == "custom":
        if not endpoint_url:
            raise ConfigError("Provider 'custom' requires: ENDPOINT_URL")

    return ProxyConfig(
        provider=provider,
        api_key=api_key,
        model_id=model_id,
        endpoint_url=endpoint_url,
        port=port,
    )
