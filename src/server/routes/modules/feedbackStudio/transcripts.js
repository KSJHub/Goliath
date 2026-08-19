'use strict';

// src/server/routes/modules/feedbackStudio/transcripts.js

const express = require('express');

const ticketTranscriptManager = require('../../../../modules/feedbackStudio/tickets/ticketsTranscripts');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Transcripts API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Transcript API request failed.' });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{16,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function filterRecords(records = [], query = {}) {
  let result = [...records];

  if (query.search) {
    const search = String(query.search).trim().toLowerCase();
    result = result.filter((record) => [record.ticketId, record.displayId, record.creatorId, record.channelId, record.ticketType, record.jsonFileName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search)));
  }

  if (query.type) {
    const type = String(query.type).trim().toLowerCase();
    result = result.filter((record) => String(record.ticketType || '').toLowerCase() === type);
  }

  if (query.userId) {
    const userId = String(query.userId).replace(/[<@!>]/g, '').trim();
    result = result.filter((record) => record.creatorId === userId);
  }

  return result;
}

router.get('/:guildId/overview', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, overview: ticketTranscriptManager.getTranscriptOverview(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const records = filterRecords(ticketTranscriptManager.listTicketTranscriptRecords(guildId), req.query);

    return success(res, {
      guildId,
      total: records.length,
      transcripts: records.slice(0, limit),
      overview: ticketTranscriptManager.getTranscriptOverview(guildId),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/json/:fileName', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, transcript: ticketTranscriptManager.readTranscript(guildId, req.params.fileName) });
  } catch (error) {
    return failure(res, error, 404);
  }
});

router.get('/:guildId/html/:fileName', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const html = ticketTranscriptManager.readTranscriptHtml(guildId, req.params.fileName);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (error) {
    return failure(res, error, 404);
  }
});

module.exports = router;
