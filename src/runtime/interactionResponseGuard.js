'use strict';

const ACKNOWLEDGEMENT_ERROR_CODES = new Set([10062, 40060]);

function shouldPreDefer() {
  // Global pre-deferral breaks any button that must open a Discord modal because
  // showModal() has to be the interaction's first acknowledgement. Individual
  // handlers already defer explicitly when they perform slower work.
  return false;
}

function isAcknowledgementError(error) {
  return ACKNOWLEDGEMENT_ERROR_CODES.has(Number(error?.code));
}

function logIgnoredAcknowledgementError(interaction, method, error) {
  console.warn(
    `[InteractionGuard] Ignored ${error?.code || 'unknown'} from ${method} ` +
    `for ${interaction?.customId || interaction?.commandName || interaction?.id || 'unknown interaction'}.`
  );
}

function wrapResponses(interaction) {
  if (!interaction || interaction.__goliathResponsesGuarded) return;
  interaction.__goliathResponsesGuarded = true;

  const originalDeferUpdate = typeof interaction.deferUpdate === 'function'
    ? interaction.deferUpdate.bind(interaction)
    : null;
  const originalUpdate = typeof interaction.update === 'function'
    ? interaction.update.bind(interaction)
    : null;
  const originalReply = typeof interaction.reply === 'function'
    ? interaction.reply.bind(interaction)
    : null;

  if (originalDeferUpdate) {
    interaction.deferUpdate = async (...args) => {
      if (interaction.deferred || interaction.replied) return interaction;
      try {
        return await originalDeferUpdate(...args);
      } catch (error) {
        if (isAcknowledgementError(error)) {
          logIgnoredAcknowledgementError(interaction, 'deferUpdate', error);
          return interaction;
        }
        throw error;
      }
    };
  }

  if (originalUpdate) {
    interaction.update = async (payload) => {
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
      }

      try {
        return await originalUpdate(payload);
      } catch (error) {
        if (isAcknowledgementError(error)) {
          logIgnoredAcknowledgementError(interaction, 'update', error);
          return interaction;
        }
        throw error;
      }
    };
  }

  if (originalReply) {
    interaction.reply = async (payload) => {
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
      }

      try {
        return await originalReply(payload);
      } catch (error) {
        if (isAcknowledgementError(error)) {
          logIgnoredAcknowledgementError(interaction, 'reply', error);
          return interaction;
        }
        throw error;
      }
    };
  }
}

async function prepareInteraction(interaction) {
  if (!interaction?.isMessageComponent?.()) return;
  wrapResponses(interaction);
  if (!shouldPreDefer(interaction)) return;

  if (!interaction.__goliathPreparePromise) {
    interaction.__goliathPreparePromise = (async () => {
      if (interaction.deferred || interaction.replied) return;
      await interaction.deferUpdate();
    })();
  }

  try {
    await interaction.__goliathPreparePromise;
  } catch (error) {
    if (isAcknowledgementError(error)) {
      logIgnoredAcknowledgementError(interaction, 'prepareInteraction', error);
      return;
    }
    throw error;
  }
}

module.exports = {
  prepareInteraction,
};
