const loggingService = require('../../core/logging/service');

function roleLabel(role) {
  if (!role) return 'Unknown Role';
  return `${role} \`${role.name || role.id}\``;
}

function permissionsChanged(oldRole, newRole) {
  return oldRole.permissions.bitfield !== newRole.permissions.bitfield;
}

function formatPosition(role) {
  return Number.isFinite(role?.position) ? String(role.position) : 'Unknown';
}

function formatColor(role) {
  return role?.hexColor || '#000000';
}

async function logRoleCreate(role) {
  if (!role?.guild) return;

  await loggingService.send(role.guild, 'role.create', {
    title: 'Role Created',
    color: '#57F287',
    fields: [
      { name: 'Role', value: roleLabel(role), inline: true },
      { name: 'Role ID', value: `\`${role.id}\``, inline: true },
      { name: 'Position', value: `\`${formatPosition(role)}\``, inline: true },
      { name: 'Colour', value: `\`${formatColor(role)}\``, inline: true },
      { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
      { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
    ],
  });
}

async function logRoleDelete(role) {
  if (!role?.guild) return;

  await loggingService.send(role.guild, 'role.delete', {
    title: 'Role Deleted',
    color: '#ED4245',
    fields: [
      { name: 'Role Name', value: `\`${role.name || 'Unknown'}\``, inline: true },
      { name: 'Role ID', value: `\`${role.id}\``, inline: true },
      { name: 'Position', value: `\`${formatPosition(role)}\``, inline: true },
      { name: 'Colour', value: `\`${formatColor(role)}\``, inline: true },
    ],
  });
}

async function logRoleUpdate(oldRole, newRole) {
  if (!newRole?.guild) return;

  const changes = [];
  let eventType = 'role.update';

  if (oldRole.name !== newRole.name) {
    eventType = 'role.nameUpdate';
    changes.push(`Name: \`${oldRole.name}\` to \`${newRole.name}\``);
  }

  if (oldRole.hexColor !== newRole.hexColor) {
    eventType = eventType === 'role.update' ? 'role.colorUpdate' : eventType;
    changes.push(`Colour: \`${oldRole.hexColor}\` to \`${newRole.hexColor}\``);
  }

  if (oldRole.position !== newRole.position) {
    eventType = eventType === 'role.update' ? 'role.positionUpdate' : eventType;
    changes.push(`Position: \`${formatPosition(oldRole)}\` to \`${formatPosition(newRole)}\``);
  }

  if (oldRole.mentionable !== newRole.mentionable) {
    changes.push(`Mentionable: \`${oldRole.mentionable ? 'Yes' : 'No'}\` to \`${newRole.mentionable ? 'Yes' : 'No'}\``);
  }

  if (oldRole.hoist !== newRole.hoist) {
    changes.push(`Hoisted: \`${oldRole.hoist ? 'Yes' : 'No'}\` to \`${newRole.hoist ? 'Yes' : 'No'}\``);
  }

  if (permissionsChanged(oldRole, newRole)) {
    eventType = eventType === 'role.update' ? 'role.permissionsUpdate' : eventType;
    changes.push('Permissions changed');
  }

  if (!changes.length) return;

  await loggingService.send(newRole.guild, eventType, {
    title: 'Role Updated',
    color: '#5865F2',
    fields: [
      { name: 'Role', value: roleLabel(newRole), inline: true },
      { name: 'Role ID', value: `\`${newRole.id}\``, inline: true },
      { name: 'Changes', value: changes.join('\n').slice(0, 1024), inline: false },
    ],
  });
}

module.exports = [
  {
    name: 'roleCreate',
    async execute(role) {
      await logRoleCreate(role);
    },
  },
  {
    name: 'roleDelete',
    async execute(role) {
      await logRoleDelete(role);
    },
  },
  {
    name: 'roleUpdate',
    async execute(oldRole, newRole) {
      await logRoleUpdate(oldRole, newRole);
    },
  },
];
