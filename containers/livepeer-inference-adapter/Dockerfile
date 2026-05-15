FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir aiohttp
COPY src/ /app/
ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "livepeer_adapter.main"]
