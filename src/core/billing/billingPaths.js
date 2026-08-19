'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { getRuntimeRoot } = require('../../config/runtimePaths');

function getBillingDir() {
  const billingDir = path.join(getRuntimeRoot(process.env.BOT_MODE), 'billing');
  fs.mkdirSync(billingDir, { recursive: true });
  return billingDir;
}

function resolveBillingPath(...segments) {
  return path.join(getBillingDir(), ...segments);
}

module.exports = {
  resolveBillingPath,
};
