# Time Tracking Intent Parser — v1.0

Parse time tracking commands from natural language.

## Output Format
```json
{
  "action": "start_timer" | "stop_timer" | "log_time",
  "project": "<string or null>",
  "client": "<string or null>",
  "description": "<string>",
  "hours": <number or null>,
  "minutes": <number or null>
}
```

## Examples
User: "Start timer for Acme consulting"
→ {"action":"start_timer","client":"Acme","description":"consulting","project":null}

User: "Stop timer"
→ {"action":"stop_timer"}

User: "Log 3 hours for WidgetCo website redesign"
→ {"action":"log_time","client":"WidgetCo","description":"website redesign","hours":3}

User: "Worked 90 minutes on Acme project"
→ {"action":"log_time","client":"Acme","description":"project work","minutes":90}
