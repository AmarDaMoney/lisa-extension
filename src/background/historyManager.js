/**
 * LISA Extension - History Manager
 * v0.40 - Manages snapshot history storage (last 50 snapshots)
 * Completely isolated - no dependencies on existing snapshot code
 */

const STORAGE_KEY = 'snapshotHistory';
const MAX_SNAPSHOTS = 50;

/**
 * Save snapshot to history
 * @param {string} url - Page URL
 * @param {string} title - Page title
 * @param {string} format - 'lisa-v' or 'raw'
 * @param {number} elementCount - Number of elements
 * @returns {Promise<string>} Snapshot ID
 */
async function saveToHistory(url, title, format, elementCount) {
  try {
    const history = await getHistory();
    
    const newItem = {
      id: Date.now().toString(),
      url,
      title,
      savedAt: Date.now(),
      format,
      elementCount
    };
    
    // Add to beginning (newest first)
    history.unshift(newItem);
    
    // Keep only last 50
    if (history.length > MAX_SNAPSHOTS) {
      history.pop();
    }
    
    await chrome.storage.local.set({ [STORAGE_KEY]: history });
    console.log('[LISA] Saved to history:', newItem.id);
    
    // Update badge
    updateBadgeCount();
    
    return newItem.id;
  } catch (error) {
    console.error('[LISA] Error saving to history:', error);
    throw error;
  }
}

/**
 * Get all snapshots from history
 * @returns {Promise<Array>} Array of snapshot history items
 */
async function getHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || [];
  } catch (error) {
    console.error('[LISA] Error getting history:', error);
    return [];
  }
}

/**
 * Delete a snapshot from history
 * @param {string} id - Snapshot ID
 */
async function deleteFromHistory(id) {
  try {
    const history = await getHistory();
    const filtered = history.filter(item => item.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
    console.log('[LISA] Deleted from history:', id);
    updateBadgeCount();
  } catch (error) {
    console.error('[LISA] Error deleting from history:', error);
    throw error;
  }
}

/**
 * Clear all history
 */
async function clearHistory() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    console.log('[LISA] History cleared');
    chrome.action.setBadgeText({ text: '' });
  } catch (error) {
    console.error('[LISA] Error clearing history:', error);
    throw error;
  }
}

/**
 * Get history statistics
 * @returns {Promise<Object>} Stats object {total, livaV, rawJson}
 */
async function getHistoryStats() {
  try {
    const history = await getHistory();
    return {
      total: history.length,
      livaV: history.filter(h => h.format === 'lisa-v').length,
      rawJson: history.filter(h => h.format === 'raw').length
    };
  } catch (error) {
    console.error('[LISA] Error getting history stats:', error);
    return { total: 0, livaV: 0, rawJson: 0 };
  }
}

/**
 * Update extension badge with snapshot count
 */
async function updateBadgeCount() {
  try {
    const history = await getHistory();
    const count = history.length;
    
    if (count > 0) {
      chrome.action.setBadgeText({ text: count.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    console.error('[LISA] Error updating badge:', error);
  }
}

// Initialize badge on startup
updateBadgeCount();
