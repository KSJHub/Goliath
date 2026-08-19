const loggingService = require('../../core/logging/service');

function threadLabel(thread) {
  if (!thread) return 'Unknown Thread';
  return `${thread} \`${thread.name || thread.id}\``;
}

async function logThreadCreate(thread) {
  if (!thread?.guild) return;

  await loggingService.send(thread.guild, 'thread.create', {
    title: 'Thread Created',
    color: '#57F287',
    fields: [
      { name: 'Thread', value: threadLabel(thread), inline: true },
      { name: 'Parent', value: thread.parent ? `${thread.parent}` : 'Unknown', inline: true },
      { name: 'Thread ID', value: `\`${thread.id}\``, inline: true },
    ],
  });
}

async function logThreadDelete(thread) {
  if (!thread?.guild) return;

  await loggingService.send(thread.guild, 'thread.delete', {
    title: 'Thread Deleted',
    color: '#ED4245',
    fields: [
      { name: 'Name', value: `\`${thread.name || 'Unknown'}\``, inline: true },
      { name: 'Parent', value: thread.parent ? `${thread.parent}` : 'Unknown', inline: true },
      { name: 'Thread ID', value: `\`${thread.id}\``, inline: true },
    ],
  });
}

async function logThreadUpdate(oldThread, newThread) {
  if (!newThread?.guild) return;

  const changes = [];
  let eventType = 'thread.nameUpdate';

  if (oldThread.name !== newThread.name) {
    eventType = 'thread.nameUpdate';
    changes.push(`Name: \`${oldThread.name}\` to \`${newThread.name}\``);
  }

  if (oldThread.archived !== newThread.archived) {
    eventType = eventType === 'thread.nameUpdate' && changes.length ? eventType : 'thread.archiveUpdate';
    changes.push(`Archived: \`${oldThread.archived ? 'Yes' : 'No'}\` to \`${newThread.archived ? 'Yes' : 'No'}\``);
  }

  if (oldThread.locked !== newThread.locked) {
    eventType = eventType === 'thread.nameUpdate' && changes.length ? eventType : 'thread.lockedUpdate';
    changes.push(`Locked: \`${oldThread.locked ? 'Yes' : 'No'}\` to \`${newThread.locked ? 'Yes' : 'No'}\``);
  }

  if (!changes.length) return;

  await loggingService.send(newThread.guild, eventType, {
    title: 'Thread Updated',
    color: '#5865F2',
    fields: [
      { name: 'Thread', value: threadLabel(newThread), inline: true },
      { name: 'Thread ID', value: `\`${newThread.id}\``, inline: true },
      { name: 'Changes', value: changes.join('\n').slice(0, 1024), inline: false },
    ],
  });
}

async function logThreadMemberAdd(member) {
  const thread = member?.thread;
  if (!thread?.guild) return;

  await loggingService.send(thread.guild, 'thread.memberAdd', {
    title: 'Thread Member Added',
    color: '#57F287',
    fields: [
      { name: 'Thread', value: threadLabel(thread), inline: true },
      { name: 'User ID', value: `\`${member.id}\``, inline: true },
    ],
  });
}

async function logThreadMemberRemove(member) {
  const thread = member?.thread;
  if (!thread?.guild) return;

  await loggingService.send(thread.guild, 'thread.memberRemove', {
    title: 'Thread Member Removed',
    color: '#ED4245',
    fields: [
      { name: 'Thread', value: threadLabel(thread), inline: true },
      { name: 'User ID', value: `\`${member.id}\``, inline: true },
    ],
  });
}

async function logThreadMembersUpdate(oldMembers, newMembers) {
  for (const [memberId, member] of newMembers) {
    if (!oldMembers.has(memberId)) await logThreadMemberAdd(member);
  }

  for (const [memberId, member] of oldMembers) {
    if (!newMembers.has(memberId)) await logThreadMemberRemove(member);
  }
}

module.exports = [
  { name: 'threadCreate', async execute(thread) { await logThreadCreate(thread); } },
  { name: 'threadDelete', async execute(thread) { await logThreadDelete(thread); } },
  { name: 'threadUpdate', async execute(oldThread, newThread) { await logThreadUpdate(oldThread, newThread); } },
  { name: 'threadMembersUpdate', async execute(oldMembers, newMembers) { await logThreadMembersUpdate(oldMembers, newMembers); } },
];
