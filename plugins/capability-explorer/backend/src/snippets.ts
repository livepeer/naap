import type { CapabilityCategory, SdkSnippet } from './types.js';

const GATEWAY_BASE_URL = 'https://dream-gateway.livepeer.cloud';

const SNIPPET_CONFIGS: Record<string, { contentType: string; bodyTemplate: string }> = {
  't2i': {
    contentType: 'application/json',
    bodyTemplate: '{"prompt": "a beautiful sunset over mountains", "model_id": "MODEL_ID", "width": 1024, "height": 1024}',
  },
  'i2i': {
    contentType: 'multipart/form-data',
    bodyTemplate: '-F "image=@input.png" -F "prompt=enhance this image" -F "model_id=MODEL_ID"',
  },
  'i2v': {
    contentType: 'multipart/form-data',
    bodyTemplate: '-F "image=@input.png" -F "model_id=MODEL_ID"',
  },
  't2v': {
    contentType: 'application/json',
    bodyTemplate: '{"prompt": "a cat walking in a garden", "model_id": "MODEL_ID"}',
  },
  'llm': {
    contentType: 'application/json',
    bodyTemplate: '{"model": "MODEL_ID", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 256}',
  },
  'a2t': {
    contentType: 'multipart/form-data',
    bodyTemplate: '-F "audio=@input.wav" -F "model_id=MODEL_ID"',
  },
  'tts': {
    contentType: 'application/json',
    bodyTemplate: '{"text": "Hello, world!", "model_id": "MODEL_ID"}',
  },
  'upscale': {
    contentType: 'multipart/form-data',
    bodyTemplate: '-F "image=@input.png" -F "model_id=MODEL_ID" -F "prompt=upscale"',
  },
};

const PIPELINE_PATHS: Record<string, string> = {
  't2i': 'text-to-image',
  'i2i': 'image-to-image',
  'i2v': 'image-to-video',
  't2v': 'text-to-video',
  'llm': 'llm',
  'a2t': 'audio-to-text',
  'tts': 'text-to-speech',
  'upscale': 'upscale',
  'live-video': 'live-video-to-video',
  'other': 'text-to-image',
};

function getCurlSnippet(pipelinePath: string, category: CapabilityCategory, modelId: string): string {
  const config = SNIPPET_CONFIGS[category];
  if (!config) {
    return `curl -X POST "${GATEWAY_BASE_URL}/${pipelinePath}" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model_id": "${modelId}"}'`;
  }

  const body = config.bodyTemplate.replace(/MODEL_ID/g, modelId);

  if (config.contentType === 'multipart/form-data') {
    return `curl -X POST "${GATEWAY_BASE_URL}/${pipelinePath}" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  ${body}`;
  }

  return `curl -X POST "${GATEWAY_BASE_URL}/${pipelinePath}" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: ${config.contentType}" \\
  -d '${body}'`;
}

function getPythonSnippet(pipelinePath: string, category: CapabilityCategory, modelId: string): string {
  const config = SNIPPET_CONFIGS[category];

  if (config?.contentType === 'multipart/form-data') {
    const fileField = category === 'a2t' ? 'audio' : 'image';
    const ext = category === 'a2t' ? 'wav' : 'png';
    return `import requests

url = "${GATEWAY_BASE_URL}/${pipelinePath}"
headers = {"Authorization": "Bearer YOUR_API_KEY"}
files = {"${fileField}": open("input.${ext}", "rb")}
data = {"model_id": "${modelId}"}

response = requests.post(url, headers=headers, files=files, data=data)
print(response.json())`;
  }

  const bodyObj = config
    ? config.bodyTemplate.replace(/MODEL_ID/g, modelId)
    : `{"model_id": "${modelId}"}`;

  return `import requests

url = "${GATEWAY_BASE_URL}/${pipelinePath}"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
}
payload = ${bodyObj}

response = requests.post(url, headers=headers, json=payload)
print(response.json())`;
}

function getJavaScriptSnippet(pipelinePath: string, category: CapabilityCategory, modelId: string): string {
  const config = SNIPPET_CONFIGS[category];

  if (config?.contentType === 'multipart/form-data') {
    const fileField = category === 'a2t' ? 'audio' : 'image';
    return `const formData = new FormData();
formData.append("${fileField}", fileInput);
formData.append("model_id", "${modelId}");

const response = await fetch("${GATEWAY_BASE_URL}/${pipelinePath}", {
  method: "POST",
  headers: { "Authorization": "Bearer YOUR_API_KEY" },
  body: formData,
});

const result = await response.json();
console.log(result);`;
  }

  const bodyJson = config
    ? config.bodyTemplate.replace(/MODEL_ID/g, modelId)
    : `{"model_id": "${modelId}"}`;

  return `const response = await fetch("${GATEWAY_BASE_URL}/${pipelinePath}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: '${bodyJson.replace(/'/g, "\\'")}',
});

const result = await response.json();
console.log(result);`;
}

export function generateSnippets(
  capabilityId: string,
  category: CapabilityCategory,
  modelId?: string,
): SdkSnippet {
  const pipelinePath = PIPELINE_PATHS[category] || capabilityId;
  const resolvedModelId = modelId || 'YOUR_MODEL_ID';

  return {
    curl: getCurlSnippet(pipelinePath, category, resolvedModelId),
    python: getPythonSnippet(pipelinePath, category, resolvedModelId),
    javascript: getJavaScriptSnippet(pipelinePath, category, resolvedModelId),
  };
}
