'use strict';

const ticketRecovery = require('./ticketRecovery');

async function startupTickets(client) {
  if (!client) {
    return {
      ok: false,
      reason: 'Missing Discord client.',
    };
  }

  const results = await ticketRecovery.recoverAllClientGuildTickets(client);

  const summary = {
    ok: true,
    guildsChecked: results.length,
    totalTickets: 0,
    totalActiveTickets: 0,
    totalMissingChannels: 0,
    results,
  };

  for (const result of results) {
    summary.totalTickets += result.totalTickets || 0;
    summary.totalActiveTickets += result.activeTickets || 0;
    summary.totalMissingChannels += result.missingChannels?.length || 0;
  }

  console.log(
    `[Tickets] Startup recovery complete: ${summary.guildsChecked} guild(s), ${summary.totalActiveTickets} active ticket(s), ${summary.totalMissingChannels} missing channel(s).`
  );

  return summary;
}

module.exports = {
  startupTickets,
  recoverTickets: startupTickets,
};
