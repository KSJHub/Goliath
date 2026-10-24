'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const isolation = read('src/core/security/protection/quarantine/isolation.js');
const recovery = read('src/core/security/protection/quarantine/recoveryEvents.js');
const release = read('src/core/security/protection/quarantine/releaseLifecycle.js');
const verification = read('src/modules/securityStudio/verificationQuarantine.js');

function required(source, fragment, label) {
  assert(source.includes(fragment), label);
}

required(isolation, 'fetchActiveThreads()', 'Active threads must be inspected during containment verification');
required(isolation, 'allowedChannelIds', 'Authorised investigation room must be explicitly exempted');
required(isolation, 'memberViewAllowRestores', 'Member-specific permissions must be recorded for restoration');
required(recovery, 'Events.ThreadCreate', 'New threads must trigger containment checks');
required(recovery, 'Events.ThreadUpdate', 'Updated threads must trigger containment checks');
required(recovery, 'Events.ThreadMembersUpdate', 'Thread membership changes must trigger containment checks');
required(recovery, 'Events.ChannelCreate', 'New channels must trigger containment checks');
required(recovery, 'Events.ChannelUpdate', 'Channel permission changes must trigger containment checks');
required(recovery, 'Events.GuildMemberAdd', 'Rejoining members must be recontained');
required(recovery, 'Events.GuildMemberUpdate', 'Role changes must be recontained');
required(release, 'Array.isArray(snapshot.roles)', 'Release must reject missing original-role snapshots');
required(release, 'releasesInProgress', 'Release transactions must be guarded against concurrent recovery');
required(verification, 'auditLegacyQuarantineSessions', 'Legacy verification cases must be reported');
required(verification, 'legacy_without_shared_snapshot', 'Missing legacy shared snapshots must be flagged');
required(verification, 'missing_original_roles', 'Missing original roles must be flagged');
console.log('Quarantine containment contract audit passed (static checks only; live Discord permissions still require testing).');
