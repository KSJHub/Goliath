'use strict';

const fetch = require('node-fetch');

const API_URL = 'https://emoji.gg/api';
const MAX_BYTES = 256 * 1024;

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'KSJHub-Goliath/1.0 (+https://github.com/KSJHub/Goliath)',
      Accept: 'application/json',
    },
    timeout: 15000,
  });

  if (!response.ok) {
    throw new Error(`Emoji.gg request failed (${response.status})`);
  }

  return response.json();
}

async function fetchCatalogue() {
  const data = await requestJson(API_URL);
  return Array.isArray(data) ? data : [];
}

function normaliseId(value) {
  return String(value || '').trim().replace(/[^0-9]/g, '');
}

async function findById(id) {
  const wanted = normaliseId(id);
  if (!wanted) return null;

  const catalogue = await fetchCatalogue();
  return catalogue.find((entry) => String(entry.id) === wanted) || null;
}

async function search(query, limit = 25) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];

  const catalogue = await fetchCatalogue();
  return catalogue
    .filter((entry) => {
      const haystack = [entry.title, entry.slug, entry.category, entry.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 25, 25)));
}

function assetUrl(entry) {
  if (!entry) return null;
  return entry.image || entry.url || entry.src || null;
}

async function downloadAsset(url) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('Invalid emoji asset URL.');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'KSJHub-Goliath/1.0' },
    timeout: 15000,
  });

  if (!response.ok) throw new Error(`Emoji download failed (${response.status})`);

  const buffer = await response.buffer();
  if (!buffer.length) throw new Error('Emoji asset was empty.');
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Emoji asset is too large for Discord (${buffer.length} bytes).`);
  }

  return buffer;
}

module.exports = {
  API_URL,
  MAX_BYTES,
  fetchCatalogue,
  findById,
  search,
  assetUrl,
  downloadAsset,
};
