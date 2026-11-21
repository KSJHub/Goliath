import { dashboardBase } from './services/dashboardPath.js';
const PREFIX = 'goliath' + (dashboardBase ? ':' + dashboardBase + ':' : ':production:');

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Save a value to localStorage
 * @param {string} key
 * @param {any} value
 */
export function setStorage(key, value) {
  if (!hasStorage()) return;

  try {
    const data = JSON.stringify(value);
    window.localStorage.setItem(PREFIX + key, data);
  } catch (err) {
    console.error('Storage set error:', err);
  }
}

/**
 * Get a value from localStorage
 * @param {string} key
 * @param {any} defaultValue
 * @returns {any}s
 */
export function getStorage(key, defaultValue = null) {
  if (!hasStorage()) return defaultValue;

  try {
    const data = window.localStorage.getItem(PREFIX + key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (err) {
    console.error('Storage get error:', err);
    return defaultValue;
  }
}

/**
 * Remove a value
 * @param {string} key
 */
export function removeStorage(key) {
  if (!hasStorage()) return;

  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch (err) {
    console.error('Storage remove error:', err);
  }
}

/**
 * Clear ALL storage
 */
export function clearStorage() {
  if (!hasStorage()) return;

  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch (err) {
    console.error('Storage clear error:', err);
  }
}
