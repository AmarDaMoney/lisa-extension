/**
 * LISA Extension - Capture Configuration Manager
 * v0.40 - Manages user capture preferences
 */

const DEFAULT_CAPTURE_CONFIG = {
  includeScripts: false,
  includeStyles: false,
  includeHidden: false,
  filterTypes: []
};

const STORAGE_KEY = 'captureConfig';

/**
 * Get current capture configuration
 * @returns {Promise<Object>} Capture config
 */
async function getCaptureConfig() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return result[STORAGE_KEY] || DEFAULT_CAPTURE_CONFIG;
  } catch (error) {
    console.error('[LISA] Error getting capture config:', error);
    return DEFAULT_CAPTURE_CONFIG;
  }
}

/**
 * Set capture configuration
 * @param {Object} config - New capture config
 */
async function setCaptureConfig(config) {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: config });
    console.log('[LISA] Capture config updated:', config);
  } catch (error) {
    console.error('[LISA] Error setting capture config:', error);
  }
}

/**
 * Reset capture configuration to defaults
 */
async function resetCaptureConfig() {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_CAPTURE_CONFIG });
    console.log('[LISA] Capture config reset to defaults');
  } catch (error) {
    console.error('[LISA] Error resetting capture config:', error);
  }
}

/**
 * Update a single capture config option
 * @param {string} key - Config key to update
 * @param {*} value - New value
 */
async function updateCaptureConfigOption(key, value) {
  const config = await getCaptureConfig();
  config[key] = value;
  await setCaptureConfig(config);
}
