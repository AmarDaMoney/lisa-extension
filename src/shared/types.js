/**
 * LISA Extension - Type Definitions
 * v0.40 - Capture config and history types
 */

/**
 * @typedef {Object} CaptureConfig
 * @property {boolean} includeScripts - Whether to include script tags
 * @property {boolean} includeStyles - Whether to include style tags
 * @property {boolean} includeHidden - Whether to include hidden elements
 * @property {string[]} filterTypes - Array of element types to capture (empty = all)
 */

/**
 * @typedef {Object} SnapshotHistoryItem
 * @property {string} id - Unique ID for this snapshot
 * @property {string} url - Page URL
 * @property {string} title - Page title
 * @property {number} savedAt - Timestamp when saved
 * @property {string} format - Format: 'lisa-v' or 'raw'
 * @property {number} elementCount - Number of elements captured
 */

const DEFAULT_CAPTURE_CONFIG = {
  includeScripts: false,
  includeStyles: false,
  includeHidden: false,
  filterTypes: []
};

// Export for Node-like environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_CAPTURE_CONFIG
  };
}
