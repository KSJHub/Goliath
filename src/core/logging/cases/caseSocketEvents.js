'use strict';

// src/core/logging/cases/caseSocketEvents.js

const {
  emitGuildUpdate,
} = require('../../../server/sockets/socketHub');

const EVENTS = Object.freeze({
  CASE_CREATED: 'case.created',
  CASE_UPDATED: 'case.updated',
  CASE_STATUS_UPDATED: 'case.status.updated',
  CASE_NOTE_UPDATED: 'case.note.updated',
});

function now() {
  return new Date().toISOString();
}

function createPayload(event, guildId, data = {}) {
  const timestamp = now();

  return {
    module: 'cases',
    event,
    guildId: String(guildId),
    timestamp,
    updatedAt: timestamp,
    data,
  };
}

function emit(event, guildId, data = {}) {
  const payload = createPayload(event, guildId, data);
  const update = emitGuildUpdate(guildId, payload);

  if (!update) return payload;

  return update;
}

function casePayload(caseRecord = {}) {
  return {
    caseId: caseRecord.caseId || null,
    userId: caseRecord.userId || null,
    moderatorId: caseRecord.moderatorId || null,
    action: caseRecord.action || null,
    reason: caseRecord.reason || null,
    metadata: caseRecord.metadata || {},
    status: caseRecord.status || null,
    relatedCaseId: caseRecord.relatedCaseId || null,
    note: caseRecord.note || null,
    createdAt: caseRecord.createdAt || null,
    updatedAt: caseRecord.updatedAt || null,
  };
}

function emitCaseCreated(guildId, caseRecord) {
  return emit(EVENTS.CASE_CREATED, guildId, casePayload(caseRecord));
}

function emitCaseUpdated(guildId, caseRecord) {
  return emit(EVENTS.CASE_UPDATED, guildId, casePayload(caseRecord));
}

function emitCaseStatusUpdated(guildId, caseRecord) {
  return emit(EVENTS.CASE_STATUS_UPDATED, guildId, casePayload(caseRecord));
}

function emitCaseNoteUpdated(guildId, caseRecord) {
  return emit(EVENTS.CASE_NOTE_UPDATED, guildId, casePayload(caseRecord));
}

module.exports = {
  EVENTS,
  emit,
  emitCaseCreated,
  emitCaseUpdated,
  emitCaseStatusUpdated,
  emitCaseNoteUpdated,
};
