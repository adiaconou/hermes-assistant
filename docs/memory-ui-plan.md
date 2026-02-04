# Memory UI Plan

A simple web interface for viewing and managing stored user memories at `/admin/memory`.

## Overview

Build a lightweight, self-contained HTML page that displays all memories with their metadata and allows deletion. The page will use CSS variables for light/dark mode and vanilla JavaScript for interactivity.

## Features

1. **Display all memories** grouped by user (phone number)
2. **Show all metadata** for each memory:
   - ID
   - Fact text
   - Category (if present)
   - Extracted timestamp (human-readable)
3. **Delete functionality** - delete individual memories with confirmation
4. **Light/dark mode toggle** - persisted to localStorage
5. **Responsive design** - works on desktop and mobile

## Technical Approach

### Files to Create

1. **`src/admin/views/memory.html`** - The HTML template with inline CSS/JS
2. **`src/admin/memory.ts`** - API handlers for list and delete
3. **`src/admin/index.ts`** - Express router that mounts all admin routes
4. **Update `src/index.ts`** - Register the admin router

### Folder Structure

```
src/
├── admin/
│   ├── index.ts        # Express router mounting all admin routes
│   ├── memory.ts       # Memory API handlers
│   └── views/
│       └── memory.html # HTML template
├── routes/
│   └── ...existing
└── index.ts            # Mount admin router
```

### API Design

#### GET /admin/memory
Serves the HTML page.

#### GET /admin/api/memories
Returns all memories from all users.

```json
{
  "memories": [
    {
      "id": "uuid",
      "phoneNumber": "+1234567890",
      "fact": "Likes black coffee",
      "category": "preferences",
      "extractedAt": 1706800000000
    }
  ]
}
```

#### DELETE /admin/api/memories/:id
Deletes a memory by ID. Returns 204 on success, 404 if not found.

### UI Design

#### Layout
- Header with title and dark mode toggle
- Summary section showing total memory count
- Memories grouped by phone number in collapsible sections
- Each memory displayed as a card with:
  - Fact text (prominent)
  - Category badge (if present)
  - Timestamp
  - ID (smaller, for reference)
  - Delete button

#### Light/Dark Mode
- CSS variables for colors
- Toggle button in header
- Preference saved to localStorage
- Respects system preference on first load (`prefers-color-scheme`)

#### Styling
- Clean, minimal design
- No external CSS frameworks
- Inline styles in HTML (single file served)
- Mobile-responsive with flexbox/grid

### Security Considerations

- No authentication (internal tool) - document this in comments
- CSRF not needed since DELETE is idempotent and low-risk
- Input sanitization for displayed content (escape HTML)

## Implementation Steps

1. Create `src/admin/views/memory.html` - HTML template with inline CSS/JS
2. Create `src/admin/memory.ts` - API handlers for list and delete
3. Create `src/admin/index.ts` - Express router mounting admin routes
4. Update `src/index.ts` to register admin router
5. Add tests for the API endpoints

## File Structure After Implementation

```
src/
├── admin/
│   ├── index.ts        # NEW - Admin router
│   ├── memory.ts       # NEW - Memory API handlers
│   └── views/
│       └── memory.html # NEW - HTML template
├── routes/
│   ├── pages.ts
│   ├── sms.ts
│   └── auth.ts
└── index.ts            # MODIFIED - Register admin router
```

## Example UI Mockup (ASCII)

```
┌─────────────────────────────────────────────────────────┐
│  🧠 Memory Manager                            [🌙/☀️]  │
├─────────────────────────────────────────────────────────┤
│  Total memories: 15                                      │
├─────────────────────────────────────────────────────────┤
│  📱 +1234567890 (8 memories)                    [▼]     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Likes black coffee               [preferences]  │    │
│  │ Jan 15, 2024 10:30 AM                          │    │
│  │ ID: abc-123                          [Delete]  │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Has a dog named Max              [relationships]│    │
│  │ Jan 14, 2024 3:45 PM                           │    │
│  │ ID: def-456                          [Delete]  │    │
│  └─────────────────────────────────────────────────┘    │
│  ...                                                    │
├─────────────────────────────────────────────────────────┤
│  📱 +0987654321 (7 memories)                    [▶]     │
│  (collapsed)                                            │
└─────────────────────────────────────────────────────────┘
```

## Testing Plan

1. **Unit tests** for API endpoints:
   - GET /admin/api/memories returns correct structure
   - DELETE /admin/api/memories/:id removes memory
   - DELETE /admin/api/memories/:id returns 404 for unknown ID

2. **Manual testing**:
   - Light/dark mode toggle works
   - Delete confirmation shows
   - Memories refresh after delete
