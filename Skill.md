# ProfileBrowser API

HTTP API server running on `localhost:8868` for managing browser profiles.

## Base URL

```
http://localhost:8868
```

## Endpoints

### GET /list_profiles

List all profiles with their running status and CDP port.

**Response:**
```json
{
  "profiles": [
    {
      "id": "uuid",
      "name": "Profile Name",
      "color": "#FF6B6B",
      "partition": "sessions/uuid",
      "homeUrl": "https://example.com/",
      "createdAt": 1775358394214,
      "isRunning": true,
      "cdpPort": 9224
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `isRunning` | boolean | Whether the profile is currently active in the browser |
| `cdpPort` | number | External CDP proxy port (only present if `isRunning: true`) |

---

### POST /create_profile

Create a new browser profile.

**Request Body:**
```json
{
  "name": "My Profile",
  "color": "#10b981"
}
```

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `name` | string | Yes | - |
| `color` | string | No | `#6366f1` |

**Response:** `201 Created`
```json
{
  "profile": {
    "id": "uuid",
    "name": "My Profile",
    "color": "#10b981",
    "partition": "sessions/uuid",
    "homeUrl": "about:blank",
    "createdAt": 1775453334348
  }
}
```

---

## Error Responses

| Status | Description |
|--------|-------------|
| `400` | Invalid request (missing name, malformed JSON) |
| `404` | Endpoint not found |
| `500` | Server error |

Error response format:
```json
{
  "error": "Error message description"
}
```

---

## Usage Examples

### cURL

```bash
# List all profiles
curl http://localhost:8868/list_profiles

# Create a new profile
curl -X POST http://localhost:8868/create_profile \
  -H "Content-Type: application/json" \
  -d '{"name": "My Profile", "color": "#ef4444"}'
```

### Fetch (JavaScript/TypeScript)

```typescript
// List profiles
const response = await fetch('http://localhost:8868/list_profiles');
const { profiles } = await response.json();

// Create profile
const response = await fetch('http://localhost:8868/create_profile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'My Profile', color: '#10b981' }),
});
const { profile } = await response.json();
```

---

## Notes

- The API server starts automatically when the ProfileBrowser app launches
- Profiles with `isRunning: true` can be accessed via Chrome DevTools Protocol on the listed `cdpPort`
- Profile data is persisted to `profiles.json` in the app's storage directory