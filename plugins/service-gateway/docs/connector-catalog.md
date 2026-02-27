# Connector Catalog

Reference table for all Service Gateway connectors, their transform configurations, and upstream API details.

---

## Connector Summary

| # | Slug | Name | Category | Auth | Body Transform | Response Mode | Streaming |
|---|------|------|----------|------|---------------|---------------|-----------|
| 1 | openai | OpenAI API | ai | bearer | passthrough | envelope | yes |
| 2 | gemini | Google Gemini API | ai | query | passthrough | envelope | yes |
| 3 | daydream | Daydream API | video | bearer | passthrough | envelope | yes |
| 4 | livepeer-studio | Livepeer Studio API | video | bearer | passthrough | envelope | no |
| 5 | livepeer-leaderboard | Livepeer AI Leaderboard | ai | none | passthrough | envelope | no |
| 6 | cloudflare-ai | Cloudflare Workers AI | ai | bearer | passthrough | envelope | yes |
| 7 | clickhouse | ClickHouse Cloud | database | basic | passthrough | envelope | no |
| 8 | neon | Neon Serverless Postgres | database | bearer | passthrough | envelope | no |
| 9 | pinecone | Pinecone Vector Database | database | header | passthrough | envelope | no |
| 10 | supabase | Supabase | database | header | passthrough / binary | envelope | no |
| 11 | upstash-redis | Upstash Redis | database | bearer | passthrough | raw | no |
| 12 | storj-s3 | Storj S3 Storage | storage | aws-s3 | binary | envelope | no |
| 13 | vercel-blob | Vercel Blob Storage | storage | bearer | binary | raw | no |
| 14 | stripe | Stripe Payments | payments | bearer | form-encode | raw | no |
| 15 | twilio | Twilio SMS & Voice | messaging | basic | form-encode | raw | no |
| 16 | resend | Resend Email API | email | bearer | passthrough | envelope | no |
| 17 | confluent-kafka | Confluent Kafka Cloud | messaging | basic | passthrough | envelope | no |

---

## Detailed Connector Specifications

### 1. OpenAI (`openai`)

- **Upstream**: `https://api.openai.com`
- **Auth**: Bearer token (`Authorization: Bearer {token}`)
- **Endpoints**: 6 (chat, embeddings, images, models, audio transcription, TTS)
- **Streaming**: Yes (chat completions, TTS)
- **Timeout**: 120s for chat/completions
- **Upstream docs**: https://platform.openai.com/docs/api-reference

### 2. Google Gemini (`gemini`)

- **Upstream**: `https://generativelanguage.googleapis.com`
- **Auth**: Query parameter (`?key={api_key}`)
- **Endpoints**: 4 (models, generate-content, embed-content, stream-chat)
- **Streaming**: Yes (stream-chat)
- **Upstream docs**: https://ai.google.dev/api

### 3. Daydream (`daydream`)

- **Upstream**: `https://api.daydream.live`
- **Auth**: Bearer token
- **Endpoints**: 6 (streams CRUD, models)
- **Streaming**: Yes
- **Upstream docs**: https://docs.daydream.live

### 4. Livepeer Studio (`livepeer-studio`)

- **Upstream**: `https://livepeer.studio/api`
- **Auth**: Bearer token
- **Endpoints**: 9 (streams, assets, text-to-image, image-to-video)
- **Upstream docs**: https://docs.livepeer.org

### 5. Livepeer AI Leaderboard (`livepeer-leaderboard`)

- **Upstream**: `https://leaderboard-api.livepeer.cloud`
- **Auth**: None (public API)
- **Endpoints**: 3 (pipelines, aggregated stats, raw stats)
- **Constraints**: Read-only, no auth required

### 6. Cloudflare Workers AI (`cloudflare-ai`)

- **Upstream**: `https://api.cloudflare.com`
- **Auth**: Bearer token
- **Endpoints**: 2 (run-model with wildcard path, list-models)
- **Streaming**: Yes
- **Constraints**: Path uses `{account_id}` placeholder in upstream path
- **Upstream docs**: https://developers.cloudflare.com/workers-ai

### 7. ClickHouse Cloud (`clickhouse`)

- **Upstream**: `https://api.clickhouse.cloud`
- **Auth**: Basic auth (username/password)
- **Endpoints**: 7 (organizations, services, backups)
- **Constraints**: Body validation with SQL pattern matching and blacklist
- **Upstream docs**: https://clickhouse.com/docs/en/cloud/manage/api

### 8. Neon (`neon`)

- **Upstream**: `https://console.neon.tech/api/v2`
- **Auth**: Bearer token
- **Endpoints**: 7 (projects, branches, databases)
- **Upstream docs**: https://api-docs.neon.tech

### 9. Pinecone (`pinecone`)

- **Upstream**: `https://api.pinecone.io`
- **Auth**: Custom header (`Api-Key: {key}`)
- **Endpoints**: 6 (indexes, collections)
- **Upstream docs**: https://docs.pinecone.io/reference

### 10. Supabase (`supabase`)

- **Upstream**: `https://{project_ref}.supabase.co`
- **Auth**: Custom headers (`apikey` + `Authorization: Bearer`)
- **Endpoints**: 8 (REST CRUD, auth, storage)
- **Constraints**: Binary body transform for storage uploads, wildcard paths
- **Upstream docs**: https://supabase.com/docs/reference

### 11. Upstash Redis (`upstash-redis`)

- **Upstream**: `https://{endpoint}.upstash.io`
- **Auth**: Bearer token
- **Endpoints**: 5 (command, get, set, del, keys)
- **Response**: Raw (no NaaP envelope)
- **Upstream docs**: https://upstash.com/docs/redis/overall/getstarted

### 12. Storj S3 (`storj-s3`)

- **Upstream**: `https://gateway.storjshare.io`
- **Auth**: AWS Signature V4
- **Endpoints**: 11 (buckets, objects, multipart)
- **Constraints**: Binary body transforms, most complex auth strategy
- **Upstream docs**: https://docs.storj.io/dcs/api-reference/s3-compatible-gateway

### 13. Vercel Blob (`vercel-blob`)

- **Upstream**: `https://blob.vercel-storage.com`
- **Auth**: Bearer token
- **Endpoints**: 4 (list, upload, delete, copy)
- **Response**: Raw (no NaaP envelope)
- **Constraints**: Binary uploads
- **Upstream docs**: https://vercel.com/docs/storage/vercel-blob

### 14. Stripe (`stripe`)

- **Upstream**: `https://api.stripe.com`
- **Auth**: Bearer token
- **Endpoints**: 8 (customers, payment intents, subscriptions, checkout)
- **Body transform**: `form-encode` for POST endpoints
- **Response**: Raw (no NaaP envelope)
- **Upstream docs**: https://docs.stripe.com/api

### 15. Twilio (`twilio`)

- **Upstream**: `https://api.twilio.com`
- **Auth**: Basic auth (account SID + auth token)
- **Endpoints**: 5 (messages, calls)
- **Body transform**: `form-encode` for POST endpoints
- **Response**: Raw (no NaaP envelope)
- **Constraints**: Path uses `{account_sid}` placeholder
- **Upstream docs**: https://www.twilio.com/docs/usage/api

### 16. Resend (`resend`)

- **Upstream**: `https://api.resend.com`
- **Auth**: Bearer token
- **Endpoints**: 6 (emails, domains, API keys)
- **Upstream docs**: https://resend.com/docs/api-reference

### 17. Confluent Kafka (`confluent-kafka`)

- **Upstream**: `https://{cluster}.confluent.cloud`
- **Auth**: Basic auth
- **Endpoints**: 6 (clusters, topics, records, consumer groups)
- **Upstream docs**: https://docs.confluent.io/cloud/current/api.html

---

## Transform Strategy Usage

### Body Transforms

| Strategy | Connectors using it |
|----------|-------------------|
| passthrough | openai, gemini, daydream, livepeer-studio, livepeer-leaderboard, cloudflare-ai, clickhouse, neon, pinecone, supabase (JSON), upstash-redis, resend, confluent-kafka |
| binary | storj-s3, supabase (storage), vercel-blob |
| form-encode | stripe (POST), twilio (POST) |
| static | (available, not used by default connectors) |
| template | (available, not used by default connectors) |
| extract | (available, not used by default connectors) |

### Auth Strategies

| Strategy | Connectors using it |
|----------|-------------------|
| bearer | openai, daydream, livepeer-studio, cloudflare-ai, neon, upstash-redis, vercel-blob, stripe, resend |
| basic | clickhouse, twilio, confluent-kafka |
| header | supabase, pinecone |
| query | gemini |
| aws-s3 | storj-s3 |
| none | livepeer-leaderboard |

### Response Modes

| Mode | Connectors using it |
|------|-------------------|
| envelope | openai, gemini, daydream, livepeer-studio, livepeer-leaderboard, cloudflare-ai, clickhouse, neon, pinecone, supabase, resend, confluent-kafka, storj-s3 |
| raw | upstash-redis, vercel-blob, stripe, twilio |
| streaming | openai (chat), gemini (stream), daydream, cloudflare-ai |
