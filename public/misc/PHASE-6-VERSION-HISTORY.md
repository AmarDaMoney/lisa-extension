# Phase 6: Version History - Implementation Guide

## Overview
Add Git-style version history to LISA snapshots, allowing users to see how conversations evolved, compare versions, and restore previous states.

## Why This Matters
- Users often continue conversations over multiple sessions
- Context gets lost when conversations branch
- Need audit trail for enterprise compliance
- "Time machine" for AI collaboration

---

## Architecture

### Data Model Changes

**Current snapshot structure:**
```javascript
{
  id: "snap-123",
  syncId: "sync-123",
  title: "My Conversation",
  content: "...",
  timestamp: "2026-02-02T10:00:00Z"
}
```

**New structure with versioning:**
```javascript
{
  id: "snap-123",
  syncId: "sync-123",
  title: "My Conversation",
  content: "...",
  timestamp: "2026-02-02T10:00:00Z",
  // NEW FIELDS
  version: 3,
  parentId: "snap-122",  // Previous version
  rootId: "snap-100",    // Original snapshot
  hash: "sha256-abc123", // Content hash for integrity
  delta: {               // Optional: what changed
    added: 5,            // Messages added
    modified: 0
  }
}
```

---

## Implementation Tasks

### Extension Side (lisa-extension)

#### 1. Update SnapshotManager (src/background/service-worker.js)

Find `snapshotManager` class and add:

```javascript
// Add to saveSnapshot method - detect if this is an update
async saveSnapshot(data, source) {
  const snapshots = await this.getSnapshots();
  
  // Check if this is an update to existing conversation (same URL)
  const existing = snapshots.find(s => s.url === data.url);
  
  if (existing) {
    // This is a new version
    data.version = (existing.version || 1) + 1;
    data.parentId = existing.id;
    data.rootId = existing.rootId || existing.id;
  } else {
    // First version
    data.version = 1;
    data.parentId = null;
    data.rootId = null; // Will be set to own ID after save
  }
  
  // Generate content hash
  data.hash = await this.hashContent(data.content || JSON.stringify(data));
  
  // Save with new ID (don't overwrite)
  data.id = 'snap-' + Date.now();
  // ... rest of save logic
}

async hashContent(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// Get version history for a conversation
async getVersionHistory(rootId) {
  const snapshots = await this.getSnapshots();
  return snapshots
    .filter(s => s.rootId === rootId || s.id === rootId)
    .sort((a, b) => a.version - b.version);
}
```

#### 2. Add History UI to Popup (src/popup/popup.html)

Add "History" button next to each snapshot:

```html
<button class="history-btn" data-root-id="${snapshot.rootId || snapshot.id}">
  📜 v${snapshot.version || 1}
</button>
```

Add history modal:

```html
<div id="history-modal" class="modal hidden">
  <div class="modal-content">
    <h3>Version History</h3>
    <div id="history-list"></div>
    <button id="close-history">Close</button>
  </div>
</div>
```

#### 3. Add History Handler (src/popup/popup.js)

```javascript
// Show version history
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('history-btn')) {
    const rootId = e.target.dataset.rootId;
    const response = await chrome.runtime.sendMessage({
      action: 'getVersionHistory',
      rootId: rootId
    });
    
    if (response.success) {
      showHistoryModal(response.history);
    }
  }
});

function showHistoryModal(history) {
  const list = document.getElementById('history-list');
  list.innerHTML = history.map(v => `
    <div class="history-item">
      <span>v${v.version} - ${new Date(v.timestamp).toLocaleString()}</span>
      <button data-id="${v.id}" class="restore-btn">Restore</button>
      <button data-id="${v.id}" class="compare-btn">Compare</button>
    </div>
  `).join('');
  
  document.getElementById('history-modal').classList.remove('hidden');
}
```

---

### App Side (lisa-web-backend)

#### 1. Update Database Schema (main.py)

In `init_db()` function, modify snapshots table:

```python
c.execute("""CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT,
    sync_id TEXT,
    version INTEGER DEFAULT 1,
    parent_id TEXT,
    root_id TEXT,
    hash TEXT,
    data TEXT,
    created_at TEXT
)""")
```

#### 2. Add Version History Endpoint

```python
@app.get("/api/snapshots/{root_id}/history")
async def get_snapshot_history(root_id: str, x_license_key: str = Header(None)):
    """Get version history for a snapshot."""
    license_key = x_license_key.strip().upper() if x_license_key else None
    if not validate_license(license_key):
        raise HTTPException(status_code=401, detail="Invalid license")
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT sync_id, version, hash, created_at, data 
        FROM snapshots 
        WHERE license_key = ? AND (root_id = ? OR sync_id = ?)
        ORDER BY version ASC
    """, (license_key, root_id, root_id))
    
    rows = c.fetchall()
    conn.close()
    
    history = [{
        "syncId": row[0],
        "version": row[1],
        "hash": row[2],
        "timestamp": row[3],
        "preview": json.loads(row[4]).get("title", "Untitled")
    } for row in rows]
    
    return {"success": True, "history": history}
```

#### 3. Add Compare Endpoint

```python
@app.get("/api/snapshots/compare")
async def compare_snapshots(
    id1: str, 
    id2: str, 
    x_license_key: str = Header(None)
):
    """Compare two snapshot versions."""
    # Fetch both snapshots
    # Return diff summary
    pass
```

---

### Library Page Updates (static/library.html)

Add version badge and history button:

```html
<div class="snapshot-card">
  <span class="version-badge">v${snapshot.version || 1}</span>
  <h3>${snapshot.title}</h3>
  <button onclick="showHistory('${snapshot.rootId}')">📜 History</button>
</div>
```

Add CSS:
```css
.version-badge {
  background: #3b82f6;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
}
```

---

## Testing Checklist

- [ ] Save conversation → version 1 created
- [ ] Continue same conversation, save again → version 2 created with parentId
- [ ] History button shows all versions
- [ ] Restore previous version works
- [ ] Version numbers display correctly
- [ ] Hash integrity verified

---

## Files to Modify

**Extension:**
- `src/background/service-worker.js` - SnapshotManager versioning
- `src/popup/popup.html` - History UI
- `src/popup/popup.js` - History handlers

**App:**
- `main.py` - Database schema, history endpoint
- `static/library.html` - Version display, history modal

---

## Commands Pattern

Follow Amar's working style:
1. One command at a time
2. Verify before proceeding
3. Use sed/grep for surgical edits
4. Test after each change
5. Commit frequently
