# Goal: Redesign the AI Chat Feature entirely

Feature - 1: Be able to use selected / customized LLM provider, or customized LLM provider APIKEYs for different providers(especially how to setup customized provider).
Feature - 2: Design a general agent that be able to access the database, agent wont be restricted by any RBAC restriction.
  1. Enable the agent first time(and everytime the agent starts), the agent will check if the agent specific tables are created, those tables will be created in the first database, here are the suggestions, the specific fields design should be included in the design (memory, agent_setup, threads, skills, credentials --- for example, agent's skill to talk to another api, then they need apikey)
  2. The agent should be able to interact with those agent specific table out-of-the-box.
Feature - 3: A moduled, layer code system design.
Feature - 4: Only the system admin can access the Agent.
Feature - 5: Check what is the current design of the knowledge Search and RAG Search, check how they works.

the output expected is a complete design of the revised Agent system
output the design to `scripts/customized/developments/current-design.md`

Code base could be used as a references: /home/avarile/Documents/codeRepo/TypeScript/cybernetics-group/cybernetics-agents
Current summary of the LLM Provider in Cybernetics-agentic project:
● Setting up LLM providers in cybernetics-agents

  This is a LibreChat fork, so providers come from two config layers: .env and librechat.yaml. Admins can add a third layer at runtime with database overrides through the Admin Panel. For each provider, a key can live on the server or be
  entered by each user.

  1. How a provider gets from config to a model call

  .env ──────────────┐  (built-in providers: OpenAI, Anthropic, Google, Bedrock, Azure, Assistants)
  librechat.yaml ────┼─► base AppConfig ─► + DB overrides (Admin Panel, per role/group/user, per tenant)
                     │                     └─► tenant scoping (drops custom endpoints with another tenantId)
                     ▼
  GET /api/endpoints  → getEndpointsConfig()     packages/api/src/endpoints/config/endpoints.ts
  GET /api/models     → loadConfigModels()       packages/api/src/endpoints/config/models.ts
                     ▼
  Chat / agent run    → getProviderConfig()      packages/api/src/endpoints/config/providers.ts
                        ├─ openAI/azureOpenAI → openai/initialize.ts
                        ├─ anthropic          → anthropic/initialize.ts
                        ├─ google/vertexai    → google/initialize.ts
                        ├─ bedrock            → bedrock/initialize.ts
                        └─ any other name     → custom/initialize.ts (OpenAI-compatible, or native
                                                Anthropic when `provider: anthropic`)

  A key of user_provided makes the endpoint ask each user for their own key. The frontend reads the userProvide flag from /api/endpoints and shows the key dialog.

  2. Built-in providers (.env)

  A built-in endpoint only appears when its env var is non-empty (api/server/services/Config/EndpointService.js). These values are read when the module loads, so you must restart the server after changing .env.

  ┌────────────────────┬─────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┐
  │      Provider      │                                     Key var                                     │                  Model list                  │                                  Other knobs                                   │
  ├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
  │ OpenAI             │ OPENAI_API_KEY                                                                  │ OPENAI_MODELS (otherwise fetched)            │ OPENAI_REVERSE_PROXY, OPENAI_ORGANIZATION, OPENAI_TITLE_MODEL                  │
  ├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
  │ Anthropic          │ ANTHROPIC_API_KEY                                                               │ ANTHROPIC_MODELS                             │ ANTHROPIC_REVERSE_PROXY, ANTHROPIC_USE_VERTEX, ANTHROPIC_VERTEX_REGION (newer  │
  │                    │                                                                                 │                                              │ Claude models need global, us or eu)                                           │
  ├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
  │ Google (Gemini /   │ GOOGLE_KEY, or a service account via GOOGLE_SERVICE_KEY_FILE (default           │ GOOGLE_MODELS                                │ GOOGLE_LOC, GOOGLE_REVERSE_PROXY, GOOGLE_AUTH_HEADER, GOOGLE_SAFETY_*          │
  │ Vertex)            │ api/data/auth.json)                                                             │                                              │                                                                                │
  ├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
  │ AWS Bedrock        │ BEDROCK_AWS_BEARER_TOKEN, or access key + secret (+ session token), or          │ BEDROCK_AWS_MODELS (Claude 4+ needs global.  │ BEDROCK_AWS_DEFAULT_REGION (required), BEDROCK_REVERSE_PROXY                   │
  │                    │ BEDROCK_AWS_PROFILE, or the IAM default chain                                   │ / us. profile IDs)                           │                                                                                │
  ├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
  │ Azure OpenAI       │ Use endpoints.azureOpenAI in YAML (the AZURE_* env vars are deprecated)         │ groups / deployments in YAML                 │ groupMap, modelGroupMap, serverless                                            │
  ├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
  │ Assistants         │ ASSISTANTS_API_KEY                                                              │ ASSISTANTS_MODELS                            │ ASSISTANTS_BASE_URL                                                            │
  └────────────────────┴─────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────┘

  - Order and visibility: ENDPOINTS=openAI,agents,anthropic,google,custom,... filters and orders the built-ins. Put custom in the list to control where custom endpoints appear. If it's unset, all 8 defaults are allowed.
  - User-provided keys are supported for OpenAI, Anthropic, Google, Assistants and each Bedrock credential field separately. For OpenAI, setting OPENAI_REVERSE_PROXY=user_provided lets users supply the base URL too.
  - Gemini image tool resolves its key in this order: the user's key, then GEMINI_API_KEY, then GOOGLE_KEY, then the Vertex service account.

  3. Custom (OpenAI-compatible) providers (librechat.yaml → endpoints.custom)

  This is the main way to add xAI, Groq, Mistral, OpenRouter, DeepSeek, the Vercel AI Gateway, Ollama, vLLM, LiteLLM and similar. Schema: endpointSchema in packages/data-provider/src/config.ts:2024.

  endpoints:
    custom:
      - name: 'OpenRouter'              # unique; can't reuse a built-in name (openAI, anthropic…)
        apiKey: '${OPENROUTER_KEY}'     # env reference, a literal, or 'user_provided'
        baseURL: 'https://openrouter.ai/api/v1'   # may also be 'user_provided'
        models:
          default: ['meta-llama/llama-3-70b-instruct']   # required, min 1 entry
          fetch: true                   # call {baseURL}/models; falls back to default on failure
          # userIdQuery: true
        titleConvo: true
        titleModel: 'meta-llama/llama-3-70b-instruct'
        modelDisplayLabel: 'OpenRouter'
        iconURL: 'https://…/logo.png'   # optional
        headers: { X-Title: '${APP_TITLE}' }      # supports {{LIBRECHAT_USER_*}}/{{LIBRECHAT_BODY_*}}
        addParams: { … }                # extra body params
        dropParams: ['stop', 'user']    # strip params the provider rejects
        # provider: anthropic           # use the native /v1/messages client instead of OpenAI's
        # tenantId: acme                # restrict this endpoint to one tenant
        # tokenConfig: { model: { prompt, completion, context, cacheRead } }  # pricing/context
        # customParams: { defaultParamsEndpoint, reasoningFormat, paramDefinitions… }

  Things the code does that aren't obvious:
  - An endpoint is silently dropped unless it has all of name, apiKey, baseURL and models.default or models.fetch (packages/api/src/endpoints/custom/config.ts:21).
  - An unset ${VAR} is not an error. extractEnvVariable leaves the literal string ${XAI_API_KEY} in place, so the endpoint still shows in the UI and then fails with a 401 at call time.
  - provider: anthropic points the native Anthropic client at your baseURL (custom/initialize.ts:324). It also switches the parameter panel to Anthropic fields (thinking, maxOutputTokens).
  - The names xai, deepseek, openrouter and moonshot get special provider handling and are matched case-insensitively. If two entries differ only by case, the lookup throws as ambiguous (providers.ts:181).
  - SSRF protection: a URL a user enters is validated, and private IPs are blocked unless they are listed in endpoints.allowedAddresses (host:port, private ranges only, e.g. localhost:11434 for Ollama). A baseURL the admin sets in YAML
    is trusted and not checked.
  - Fetched model lists are cached per baseURL + key. For user-provided keys or URLs they are fetched per user.
  
  4. Runtime layer: Admin Panel / admin config API

  Users with the ACCESS_ADMIN capability can store config overrides in Mongo, one document per principal (role, group or user) per tenant, merged by priority. The route is api/server/routes/admin/config.js: GET/PUT/PATCH 
  /api/admin/config/:principalType/:principalId. The admin panel at ADMIN_PANEL_URL uses this API.

  - You can add custom endpoints without editing YAML. endpoints.custom[*].apiKey is encrypted at rest (v3: prefix). Reads return only a masked apiKeyPreview (packages/api/src/admin/secrets.ts:76).
  - Some values are stored as plain references, not encrypted: user_provided and ${ENV_VAR}.
  - Leaving out apiKey on a later write keeps the stored key, so you don't need to re-enter it.
  - Each request's effective config is base YAML + the matching overrides, with tenant scoping applied (packages/api/src/app/service.ts:24-140). Endpoints that belong to another tenant are also removed from modelSpecs.

  5. Per-user keys (backend)

  - Storage: the Key collection, one document per (userId, endpointName). The value is encrypted with CREDS_KEY/CREDS_IV (packages/data-schemas/src/methods/key.ts). Set persistent CREDS_KEY/CREDS_IV values. If they are blank, the app
    generates temporary ones in .env.temp, and rotating them makes every saved user key unreadable.
  - API (api/server/routes/keys.js, JWT required):
    - PUT /api/keys {name, value, expiresAt}
    - GET /api/keys?name= returns {expiresAt: Date | 'never' | null}; null means no key saved
    - DELETE /api/keys/:name
    - DELETE /api/keys?all=true
  - Value format: a plain string for Anthropic and Google. For OpenAI and custom endpoints it is a JSON string {apiKey, baseURL?}, and Bedrock stores JSON of its credential fields.
  - Errors are coded NO_USER_KEY, INVALID_USER_KEY or EXPIRED_USER_KEY and include the endpoint name (your commit 43fddbd). The UI uses that name to offer the right key dialog.

  6. Frontend surfaces

  ┌───────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │         Where         │                                            File                                            │                                                  What it does                                                   │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Settings → Data → API │ client/src/components/Nav/SettingsTabs/ProviderKeys/ (registered in                        │ Lists the endpoints where userProvide (or a Bedrock userProvide* flag) is true and the user can reach them,     │
  │  keys → Provider API  │ Nav/Settings/registry.tsx:714)                                                             │ applying modelSpecs, addedEndpoints and agent allowedProviders (utils.ts)                                       │
  │ keys                  │                                                                                            │                                                                                                                 │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                       │                                                                                            │ Picks a form per endpoint: OpenAIConfig (also Azure and Assistants), GoogleConfig, BedrockConfig,               │
  │ Key dialog            │ client/src/components/Input/SetKeyDialog/                                                  │ CustomEndpoint (API key, plus an API URL field when userProvideURL), and OtherConfig (Anthropic, a single key). │
  │                       │                                                                                            │  Expiry options: 30 min / 2 h / 12 h (default) / 1 day / 7 days / 30 days / never. Includes revoke-one and      │
  │                       │                                                                                            │ revoke-all                                                                                                      │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Hooks                 │ client/src/hooks/Input/useUserKey.ts, useRequiresKey                                       │ Check expiry and prompt for a key before sending                                                                │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Missing-key error in  │ components/Messages/Content/Error/UserKeyError.tsx                                         │ Names the endpoint and links to the key dialog                                                                  │
  │ chat                  │                                                                                            │                                                                                                                 │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Model selector        │ built from /api/endpoints + /api/models                                                    │ Labels come from modelDisplayLabel, icons from iconURL / providerId                                             │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                       │ the agent's provider field holds an endpoint name; endpoints.agents.allowedProviders       │                                                                                                                 │
  │ Agents                │ limits the choices; the bulk "Change model" dialog (bulkModelUpdate) moves many agents at  │                                                                                                                 │
  │                       │ once                                                                                       │                                                                                                                 │
  └───────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  7. Your current setup and issues I found

  Built-ins in your .env:
  - OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_KEY and ASSISTANTS_API_KEY are all user_provided, so every user must enter their own key.
  - Bedrock and Azure aren't configured, so they don't show.
  - ENDPOINTS is unset.

  Custom endpoints in librechat.yaml:

  ┌───────────────────┬──────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │     Endpoint      │                      Key source                      │                                                                          Status                                                                           │
  ├───────────────────┼──────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ xai               │ ${XAI_API_KEY}                                       │ ⚠️  var is commented out in .env, so the endpoint shows but fails with 401                                                                                 │
  ├───────────────────┼──────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ groq              │ ${GROQ_API_KEY}                                      │ ⚠️  var unset. The models are also long retired (llama3-70b-8192, mixtral-8x7b-32768…)                                                                     │
  ├───────────────────┼──────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Mistral           │ ${MISTRAL_API_KEY}                                   │ ⚠️  var unset. The models are legacy (mistral-tiny…)                                                                                                       │
  ├───────────────────┼──────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ OpenRouter        │ ${OPENROUTER_KEY}                                    │ ⚠️  var unset                                                                                                                                              │
  ├───────────────────┼──────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Claude-Compatible │ ${ANTHROPIC_API_KEY}, which resolves to              │ Works as per-user. It duplicates the built-in Anthropic endpoint with older models (claude-sonnet-4-5). activityModel: 'claude-3-5-haiku' isn't a valid   │
  │                   │ user_provided                                        │ ID                                                                                                                                                        │
  ├───────────────────┼──────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Vercel            │ user_provided                                        │ Works per-user. Your server key AI_GATEWAY_API_KEY in .env is not referenced. Use apiKey: '${AI_GATEWAY_API_KEY}' if you meant it to be shared            │
  └───────────────────┴──────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  What to do next:
  1. Set the missing env vars, or delete the endpoints you don't use, so users stop seeing broken providers.
  2. Decide shared vs per-user per provider. A shared key is simpler for an internal team; user_provided puts cost on each user.
  3. If your 52 seeded agents point at a user_provided endpoint, every user needs a key before those agents will run. Either give those endpoints a shared key, or move the agents in bulk with Change model.
  4. Use tenantId on a YAML endpoint, or Admin Panel overrides, for keys that belong to one tenant.
  5. After any .env or YAML change, restart librechat (on k3s: kubectl rollout restart deploy/librechat -n librechat). Admin Panel changes apply without a restart.

  8. Quick recipes

  Shared server key for OpenAI:
  # .env
  OPENAI_API_KEY=sk-...
  OPENAI_MODELS=gpt-5.5,gpt-5.4-mini

  Shared key through the Vercel gateway:
  - name: 'Vercel'
    apiKey: '${AI_GATEWAY_API_KEY}'
    baseURL: 'https://ai-gateway.vercel.sh/v1'
    models: { default: ['openai/gpt-5.4', 'anthropic/claude-sonnet-5.5'], fetch: true }

  Local Ollama:
  endpoints:
    allowedAddresses: ['host.docker.internal:11434']  # only needed when users enter the URL
    custom:
      - name: 'Ollama'
        apiKey: 'ollama'
        baseURL: 'http://host.docker.internal:11434/v1'
        models: { default: ['llama3.3'], fetch: true }

  User brings their own URL and key: set apiKey: 'user_provided' and baseURL: 'user_provided'. Users fill in both under Settings → Data → Provider API keys.
