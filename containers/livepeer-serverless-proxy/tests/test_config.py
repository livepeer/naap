"""Tests for the config module."""

import pytest
from serverless_proxy.config import load_config, ConfigError, ProxyConfig


class TestLoadConfig:
    """Tests for load_config()."""

    def _set_env(self, monkeypatch, provider="fal-ai", api_key="test-key",
                 model_id="test-model", endpoint_url=None, port=None):
        monkeypatch.setenv("PROVIDER", provider)
        if api_key is not None:
            monkeypatch.setenv("API_KEY", api_key)
        else:
            monkeypatch.delenv("API_KEY", raising=False)
        if model_id is not None:
            monkeypatch.setenv("MODEL_ID", model_id)
        else:
            monkeypatch.delenv("MODEL_ID", raising=False)
        if endpoint_url is not None:
            monkeypatch.setenv("ENDPOINT_URL", endpoint_url)
        else:
            monkeypatch.delenv("ENDPOINT_URL", raising=False)
        if port is not None:
            monkeypatch.setenv("PORT", str(port))
        else:
            monkeypatch.delenv("PORT", raising=False)

    def test_loads_all_env_vars(self, monkeypatch):
        self._set_env(monkeypatch, provider="fal-ai", api_key="my-key",
                      model_id="my-model")
        config = load_config()

        assert config.provider == "fal-ai"
        assert config.api_key == "my-key"
        assert config.model_id == "my-model"

    def test_missing_provider_raises(self, monkeypatch):
        monkeypatch.delenv("PROVIDER", raising=False)
        monkeypatch.delenv("API_KEY", raising=False)
        monkeypatch.delenv("MODEL_ID", raising=False)
        monkeypatch.delenv("ENDPOINT_URL", raising=False)
        monkeypatch.delenv("PORT", raising=False)

        with pytest.raises(ConfigError, match="PROVIDER"):
            load_config()

    def test_fal_ai_without_api_key_raises(self, monkeypatch):
        self._set_env(monkeypatch, provider="fal-ai", api_key=None, model_id="model")

        with pytest.raises(ConfigError, match="API_KEY"):
            load_config()

    def test_custom_without_endpoint_url_raises(self, monkeypatch):
        self._set_env(monkeypatch, provider="custom", api_key=None, model_id=None)

        with pytest.raises(ConfigError, match="ENDPOINT_URL"):
            load_config()

    def test_default_port_is_8080(self, monkeypatch):
        self._set_env(monkeypatch)
        config = load_config()

        assert config.port == 8080

    def test_custom_port(self, monkeypatch):
        self._set_env(monkeypatch, port=9090)
        config = load_config()

        assert config.port == 9090
