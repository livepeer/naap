FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir aiohttp
COPY src/ /app/
ENV PYTHONUNBUFFERED=1
CMD ["python", "-c", "\nimport asyncio\nfrom serverless_proxy.config import load_config\nfrom serverless_proxy.server import ProxyServer, create_provider, create_extra_providers\ncfg = load_config()\nprovider = create_provider(cfg)\nextra = create_extra_providers(cfg)\nserver = ProxyServer(cfg, provider, extra_providers=extra)\nloop = asyncio.new_event_loop()\nloop.run_until_complete(server.start())\nloop.run_forever()\n"]
