'use strict';

const sentinel = require('./sentinel.js');
const coverage = require('./coverage.js');
const incidents = require('./incidentStore.js');
const scheduler = require('./schedulerRegistry.js');

module.exports = {
  ...sentinel,
  coverage,
  incidents,
  scheduler,
};
