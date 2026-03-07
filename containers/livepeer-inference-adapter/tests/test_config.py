"""Tests for the config module."""

import os
import pytest
from livepeer_adapter.config import load_config, ConfigError, AdapterConfig


class TestLoadConfig:
    """Tests for load_config()."""

    def _set_required_env(self, monkeypatch):
        monkeypatch.setenv("ORCH_URL", "http://localhost:7935")
        monkeypatch.setenv("ORCH_SECRET", "test-secret")
        monkeypatch.setenv("CAPABILITY_NAME", "test-model")
        monkeypatch.setenv("BACKEND_URL", "http://localhost:8080")

    def test_loads_required_vars(self, monkeypatch):
        self._set_required_env(monkeypatch)
        config = load_config()

        assert config.orch_url == "http://localhost:7935"
        assert config.orch_secret == "test-secret"
        assert config.capability_name == "test-model"
        assert config.backend_url == "http://localhost:8080"

    def test_raises_on_missing_required(self, monkeypatch):
        # Clear all env vars
        for var in ("ORCH_URL", "ORCH_SECRET", "CAPABILITY_NAME", "BACKEND_URL"):
            monkeypatch.delenv(var, raising=False)

        with pytest.raises(ConfigError, match="ORCH_URL"):
            load_config()

    def test_raises_on_partial_missing(self, monkeypatch):
        monkeypatch.setenv("ORCH_URL", "http://localhost:7935")
        monkeypatch.delenv("ORCH_SECRET", raising=False)
        monkeypatch.delenv("CAPABILITY_NAME", raising=False)
        monkeypatch.delenv("BACKEND_URL", raising=False)

        with pytest.raises(ConfigError) as exc_info:
            load_config()
        assert "ORCH_SECRET" in str(exc_info.value)
        assert "CAPABILITY_NAME" in str(exc_info.value)
        assert "BACKEND_URL" in str(exc_info.value)

    def test_default_values(self, monkeypatch):
        self._set_required_env(monkeypatch)
        config = load_config()

        assert config.adapter_port == 9090
        assert config.adapter_host == "0.0.0.0"
        assert config.capacity == 1
        assert config.price_per_unit == 1000
        assert config.price_scaling == 1_000_000
        assert config.price_currency == "USD"
        assert config.backend_health_path == "/health"
        assert config.backend_inference_path == "/v1/chat/completions"
        assert config.backend_timeout == 120
        assert config.health_check_interval == 15
        assert config.register_interval == 30

    def test_custom_optional_values(self, monkeypatch):
        self._set_required_env(monkeypatch)
        monkeypatch.setenv("ADAPTER_PORT", "8888")
        monkeypatch.setenv("CAPACITY", "8")
        monkeypatch.setenv("PRICE_PER_UNIT", "5000")
        monkeypatch.setenv("BACKEND_HEALTH_PATH", "/healthz")
        monkeypatch.setenv("BACKEND_INFERENCE_PATH", "/generate")
        monkeypatch.setenv("BACKEND_TIMEOUT", "300")
        monkeypatch.setenv("HEALTH_CHECK_INTERVAL", "30")
        monkeypatch.setenv("REGISTER_INTERVAL", "60")

        config = load_config()

        assert config.adapter_port == 8888
        assert config.capacity == 8
        assert config.price_per_unit == 5000
        assert config.backend_health_path == "/healthz"
        assert config.backend_inference_path == "/generate"
        assert config.backend_timeout == 300
        assert config.health_check_interval == 30
        assert config.register_interval == 60

    def test_strips_trailing_slashes(self, monkeypatch):
        monkeypatch.setenv("ORCH_URL", "http://localhost:7935/")
        monkeypatch.setenv("ORCH_SECRET", "secret")
        monkeypatch.setenv("CAPABILITY_NAME", "test")
        monkeypatch.setenv("BACKEND_URL", "http://localhost:8080/")

        config = load_config()
        assert config.orch_url == "http://localhost:7935"
        assert config.backend_url == "http://localhost:8080"

    def test_adapter_url_property(self, monkeypatch):
        self._set_required_env(monkeypatch)
        config = load_config()
        assert config.adapter_url == "http://0.0.0.0:9090"

    def test_config_is_immutable(self, monkeypatch):
        self._set_required_env(monkeypatch)
        config = load_config()

        with pytest.raises(AttributeError):
            config.orch_url = "http://new-url"
