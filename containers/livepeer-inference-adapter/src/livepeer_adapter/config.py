"""Configuration module -- loads from environment variables with validation and defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class AdapterConfig:
    """Immutable adapter configuration loaded from environment variables."""

    # Required
    orch_url: str
    orch_secret: str
    capability_name: str
    backend_url: str

    # Optional with defaults
    adapter_port: int = 9090
    adapter_host: str = "0.0.0.0"
    capacity: int = 1
    price_per_unit: int = 1000
    price_scaling: int = 1_000_000
    price_currency: str = "USD"
    backend_health_path: str = "/health"
    backend_inference_path: str = "/v1/chat/completions"
    backend_timeout: int = 120
    health_check_interval: int = 15
    register_interval: int = 30

    @property
    def adapter_url(self) -> str:
        """URL the orchestrator uses to reach this adapter."""
        return f"http://{self.adapter_host}:{self.adapter_port}"


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


def load_config() -> AdapterConfig:
    """Load configuration from environment variables.

    Raises ConfigError if required variables are missing.
    """
    missing = []
    for var in ("ORCH_URL", "ORCH_SECRET", "CAPABILITY_NAME", "BACKEND_URL"):
        if not os.environ.get(var):
            missing.append(var)

    if missing:
        raise ConfigError(f"Missing required environment variables: {', '.join(missing)}")

    return AdapterConfig(
        orch_url=os.environ["ORCH_URL"].rstrip("/"),
        orch_secret=os.environ["ORCH_SECRET"],
        capability_name=os.environ["CAPABILITY_NAME"],
        backend_url=os.environ["BACKEND_URL"].rstrip("/"),
        adapter_port=int(os.environ.get("ADAPTER_PORT", "9090")),
        adapter_host=os.environ.get("ADAPTER_HOST", "0.0.0.0"),
        capacity=int(os.environ.get("CAPACITY", "1")),
        price_per_unit=int(os.environ.get("PRICE_PER_UNIT", "1000")),
        price_scaling=int(os.environ.get("PRICE_SCALING", "1000000")),
        price_currency=os.environ.get("PRICE_CURRENCY", "USD"),
        backend_health_path=os.environ.get("BACKEND_HEALTH_PATH", "/health"),
        backend_inference_path=os.environ.get("BACKEND_INFERENCE_PATH", "/v1/chat/completions"),
        backend_timeout=int(os.environ.get("BACKEND_TIMEOUT", "120")),
        health_check_interval=int(os.environ.get("HEALTH_CHECK_INTERVAL", "15")),
        register_interval=int(os.environ.get("REGISTER_INTERVAL", "30")),
    )
