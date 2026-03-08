import React, { useState, useCallback } from 'react';
import { Copy, Check, Server, Cpu, Clock, Globe } from 'lucide-react';

interface Deployment {
  id: string;
  name: string;
  providerSlug: string;
  endpointUrl?: string;
  dockerImage: string;
  gpuModel: string;
  gpuVramGb: number;
  gpuCount: number;
  status: string;
  createdAt: string;
  providerDeploymentId?: string;
}

interface OverviewTabProps {
  deployment: Deployment;
}

type Language = 'curl' | 'python' | 'javascript' | 'go';

const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'go', label: 'Go' },
];

interface AuthInfo { envVar: string; prefix: string }

function getAuthInfo(providerSlug: string): AuthInfo {
  const map: Record<string, AuthInfo> = {
    runpod:    { envVar: 'RUNPOD_API_KEY',       prefix: 'Bearer' },
    'fal-ai':  { envVar: 'FAL_KEY',              prefix: 'Key' },
    replicate: { envVar: 'REPLICATE_API_TOKEN',  prefix: 'Bearer' },
    baseten:   { envVar: 'BASETEN_API_KEY',      prefix: 'Bearer' },
    modal:     { envVar: 'MODAL_TOKEN_ID',       prefix: 'Bearer' },
  };
  return map[providerSlug] || { envVar: 'API_KEY', prefix: 'Bearer' };
}

function getRunUrl(deployment: Deployment): string {
  if (deployment.providerSlug === 'runpod') {
    if (deployment.endpointUrl) return `${deployment.endpointUrl}/run`;
    if (deployment.providerDeploymentId) return `https://api.runpod.ai/v2/${deployment.providerDeploymentId}/run`;
  }
  return deployment.endpointUrl || 'https://api.example.com/run';
}

function generateSnippet(deployment: Deployment, lang: Language): string {
  const url = getRunUrl(deployment);
  const { envVar, prefix } = getAuthInfo(deployment.providerSlug);
  const body = '{"input": {"prompt": "Hello, world!"}}';
  const isSsh = deployment.providerSlug === 'ssh-bridge' || deployment.providerSlug === 'ssh-compose';
  const authHeader = isSsh ? '' : `${prefix} $${envVar}`;

  switch (lang) {
    case 'curl':
      return isSsh
        ? `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
        : `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: ${authHeader}" \\\n  -d '${body}'`;

    case 'python':
      return `import os
import requests

response = requests.post(
    "${url}",
    headers={
        "Content-Type": "application/json",${isSsh ? '' : `\n        "Authorization": f"${prefix} {os.environ['${envVar}']}"`}
    },
    json={"input": {"prompt": "Hello, world!"}}
)

print(response.json())`;

    case 'javascript':
      return `const response = await fetch("${url}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",${isSsh ? '' : `\n    "Authorization": \`${prefix} \${process.env.${envVar}}\``}
  },
  body: JSON.stringify({ input: { prompt: "Hello, world!" } })
});

const data = await response.json();
console.log(data);`;

    case 'go':
      return `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"${isSsh ? '' : '\n    "os"'}
)

func main() {
    body, _ := json.Marshal(map[string]interface{}{
        "input": map[string]string{"prompt": "Hello, world!"},
    })

    req, _ := http.NewRequest("POST", "${url}", bytes.NewBuffer(body))
    req.Header.Set("Content-Type", "application/json")${isSsh ? '' : `\n    req.Header.Set("Authorization", "${prefix} "+os.Getenv("${envVar}"))`}

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()
    fmt.Println(resp.Status)
}`;
  }
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ deployment }) => {
  const [selectedLang, setSelectedLang] = useState<Language>('curl');
  const [copied, setCopied] = useState(false);

  const snippet = generateSnippet(deployment, selectedLang);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback: select text */ }
  }, [snippet]);

  return (
    <div>
      {/* Deployment metadata summary */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-6">
        {[
          { icon: <Globe size={13} />, label: 'Endpoint', value: getRunUrl(deployment) },
          { icon: <Server size={13} />, label: 'Docker Image', value: deployment.dockerImage },
          { icon: <Cpu size={13} />, label: 'GPU', value: `${deployment.gpuModel} (${deployment.gpuVramGb}GB) x${deployment.gpuCount}` },
          { icon: <Clock size={13} />, label: 'Created', value: new Date(deployment.createdAt).toLocaleDateString() },
        ].map((item) => (
          <div key={item.label} className="p-3 bg-secondary rounded-md">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              {item.icon} {item.label}
            </div>
            <div className={`text-sm text-foreground font-medium break-all ${item.label === 'Endpoint' ? 'font-mono text-xs' : ''}`}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* Code snippets */}
      <div className="mb-3">
        <h3 className="text-sm font-medium mb-3 text-foreground">
          Quick Start
        </h3>

        <div className="flex gap-1 mb-3">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              data-testid={`lang-${lang.id}`}
              onClick={() => setSelectedLang(lang.id)}
              className={`h-7 px-3 rounded-md text-xs cursor-pointer transition-all ${
                selectedLang === lang.id
                  ? 'bg-foreground text-background font-medium'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <pre className="bg-zinc-900 dark:bg-zinc-950 text-zinc-100 font-mono text-xs p-4 rounded-lg overflow-x-auto leading-relaxed m-0">
            {snippet}
          </pre>
          <button
            onClick={handleCopy}
            data-testid="copy-snippet"
            className={`absolute top-2 right-2 h-7 px-2 bg-zinc-800 border border-zinc-700 rounded-md cursor-pointer flex items-center gap-1 text-xs ${
              copied ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            } transition-colors`}
          >
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        </div>
      </div>
    </div>
  );
};
