"""Configuration module -- loads from environment variables with validation and defaults."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class CapabilityConfig:
    """Configuration for a single capability."""
    name: str
    model_id: str
    capacity: int = 1
    price_per_unit: int = 0
    price_scaling: int = 1_000_000


@dataclass
class AdapterConfig:
    """Adapter configuration loaded from environment variables."""

    # Required
    orch_url: str
    orch_secret: str
    backend_url: str

    # Single capability (backward compatible)
    capability_name: Optional[str] = None

    # Multi-capability (from CAPABILITIES JSON env var or runtime API)
    capabilities: list[CapabilityConfig] = field(default_factory=list)

    # Path to persist capabilities on shutdown
    capabilities_file: str = "/app/capabilities.json"

    # Optional with defaults
    adapter_port: int = 9090
    adapter_host: str = "0.0.0.0"
    adapter_callback_url: str = ""  # URL orch uses to reach this adapter (for Docker networking)
    capacity: int = 1
    price_per_unit: int = 0
    price_scaling: int = 1_000_000
    price_currency: str = ""
    backend_health_path: str = "/health"
    backend_inference_path: str = "/inference"
    backend_timeout: int = 300
    health_check_interval: int = 15
    register_interval: int = 30

    @property
    def adapter_url(self) -> str:
        """URL the orchestrator uses to reach this adapter."""
        if self.adapter_callback_url:
            return self.adapter_callback_url.rstrip("/")
        return f"http://{self.adapter_host}:{self.adapter_port}"

    def get_capabilities(self) -> list[CapabilityConfig]:
        """Return list of capabilities to register."""
        if self.capabilities:
            return list(self.capabilities)
        if self.capability_name:
            return [CapabilityConfig(
                name=self.capability_name,
                model_id=self.capability_name,
                capacity=self.capacity,
                price_per_unit=self.price_per_unit,
                price_scaling=self.price_scaling,
            )]
        return []

    def get_model_for_capability(self, capability_name: str) -> Optional[str]:
        """Look up the model_id for a given capability name."""
        for cap in self.get_capabilities():
            if cap.name == capability_name:
                return cap.model_id
        return None

    def add_capability(self, cap: CapabilityConfig) -> None:
        """Add a capability at runtime (replaces if name exists)."""
        self.capabilities = [c for c in self.capabilities if c.name != cap.name]
        self.capabilities.append(cap)

    def remove_capability(self, name: str) -> bool:
        """Remove a capability by name. Returns True if found."""
        before = len(self.capabilities)
        self.capabilities = [c for c in self.capabilities if c.name != name]
        return len(self.capabilities) < before

    def save_capabilities(self) -> None:
        """Persist current capabilities to JSON file."""
        import json as _json
        caps = [{"name": c.name, "model_id": c.model_id, "capacity": c.capacity,
                 "price_per_unit": c.price_per_unit, "price_scaling": c.price_scaling}
                for c in self.get_capabilities()]
        try:
            with open(self.capabilities_file, "w") as f:
                _json.dump(caps, f, indent=2)
        except Exception:
            pass

    def load_saved_capabilities(self) -> bool:
        """Load capabilities from saved file. Returns True if loaded."""
        import json as _json
        try:
            with open(self.capabilities_file) as f:
                caps_list = _json.load(f)
            self.capabilities = [
                CapabilityConfig(
                    name=c["name"], model_id=c.get("model_id", c["name"]),
                    capacity=c.get("capacity", 1), price_per_unit=c.get("price_per_unit", 0),
                    price_scaling=c.get("price_scaling", 1_000_000),
                ) for c in caps_list
            ]
            return True
        except (FileNotFoundError, Exception):
            return False


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


def load_config() -> AdapterConfig:
    """Load configuration from environment variables.

    Supports two modes:
      - Single capability: CAPABILITY_NAME env var (backward compatible)
      - Multi-capability: CAPABILITIES env var (JSON array)

    Raises ConfigError if required variables are missing.
    """
    missing = []
    for var in ("ORCH_URL", "ORCH_SECRET", "BACKEND_URL"):
        if not os.environ.get(var):
            missing.append(var)

    if missing:
        raise ConfigError(f"Missing required environment variables: {', '.join(missing)}")

    # Parse CAPABILITIES JSON if present
    capabilities: list[CapabilityConfig] = []
    caps_json = os.environ.get("CAPABILITIES")
    if caps_json:
        try:
            caps_list = json.loads(caps_json)
            capabilities = [
                CapabilityConfig(
                    name=c["name"],
                    model_id=c.get("model_id", c["name"]),
                    capacity=c.get("capacity", 1),
                    price_per_unit=c.get("price_per_unit", 0),
                    price_scaling=c.get("price_scaling", 1_000_000),
                )
                for c in caps_list
            ]
        except (json.JSONDecodeError, KeyError) as e:
            raise ConfigError(f"Invalid CAPABILITIES JSON: {e}")

    capability_name = os.environ.get("CAPABILITY_NAME")
    if not capabilities and not capability_name:
        raise ConfigError("Either CAPABILITY_NAME or CAPABILITIES must be set")

    return AdapterConfig(
        orch_url=os.environ["ORCH_URL"].rstrip("/"),
        orch_secret=os.environ["ORCH_SECRET"],
        backend_url=os.environ["BACKEND_URL"].rstrip("/"),
        capability_name=capability_name,
        capabilities=capabilities,
        adapter_port=int(os.environ.get("ADAPTER_PORT", "9090")),
        adapter_host=os.environ.get("ADAPTER_HOST", "0.0.0.0"),
        adapter_callback_url=os.environ.get("ADAPTER_CALLBACK_URL", ""),
        capacity=int(os.environ.get("CAPACITY", "1")),
        price_per_unit=int(os.environ.get("PRICE_PER_UNIT", "0")),
        price_scaling=int(os.environ.get("PRICE_SCALING", "1000000")),
        price_currency=os.environ.get("PRICE_CURRENCY", ""),
        backend_health_path=os.environ.get("BACKEND_HEALTH_PATH", "/health"),
        backend_inference_path=os.environ.get("BACKEND_INFERENCE_PATH", "/inference"),
        backend_timeout=int(os.environ.get("BACKEND_TIMEOUT", "300")),
        health_check_interval=int(os.environ.get("HEALTH_CHECK_INTERVAL", "15")),
        register_interval=int(os.environ.get("REGISTER_INTERVAL", "30")),
    )
