const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
  LabelBuilder,
} = require("discord.js");

const {
  saveEmbedDeployment,
  getEmbedDeployment,
  getDeploymentKeyFromState,
} = require("./embedDeployments");
const embedState = require("./embedState");

const guildManager = require("../../../core/guild/guildManager");
const {
  validateChannelAccess,
} = require("../../../core/security/goliathPermissionGuard");

const {
  HELPERS,
  clone,
  trim,
  fmtDate,
  fmtTs,
  avatar,
  guildIcon,
  guildBanner,
  memberName,
  displayName,
  refreshGuild,
  sessionKey,
  replaceVars,
  getSession,
  saveSession,
  saveSelected,
  markUnsaved,
  clearUnsaved,
  resetSession,
  applyTemplate,
  applyPreset,
  setDefault,
  allowedMentions,
  presetData,
} = embedState;

const PANEL_COLOR = "#5865F2";
const CUSTOM_HEX_VALUE = "__custom_hex__";
const MAX_PANELS = 10;
const MAX_BUTTONS = 20;
const MAX_EMBED_FIELDS = 25;

const COLORS = [
  ["Deep Blue", "#2F80ED", "🔷"],
  ["Royal Blue", "#4169E1", "🔵"],
  ["Sky Blue", "#00BFFF", "🩵"],
  ["Electric Blue", "#007BFF", "⚡"],
  ["Cyan", "#00D4FF", "💧"],
  ["Teal", "#1ABC9C", "🌊"],
  ["Green", "#57F287", "🟢"],
  ["Emerald", "#2ECC71", "💚"],
  ["Lime", "#BFFF00", "🍏"],
  ["Yellow", "#FEE75C", "🟡"],
  ["Gold", "#FFD700", "🏆"],
  ["Amber", "#FFC107", "🌟"],
  ["Orange", "#E67E22", "🟠"],
  ["Dark Orange", "#FF8C00", "🔥"],
  ["Red", "#ED4245", "🔴"],
  ["Crimson", "#DC143C", "❤️"],
  ["Rose", "#FF4D6D", "🌹"],
  ["Discord Blurple", "#5865F2", "🔮"],
  ["Purple", "#9B59B6", "🟣"],
  ["Violet", "#8A2BE2", "🪻"],
  ["Pink", "#EB459E", "🌸"],
  ["Hot Pink", "#FF69B4", "💖"],
  ["Dark", "#2B2D31", "⬛"],
  ["White", "#FFFFFF", "🤍"],
].map(([label, value, emoji]) => ({ label, value, emoji }));

const TEMPLATES = {
  custom: {
    label: "Custom Embed",
    emoji: "🛠️",
    title: "Custom Embed",
    description: "Edit this embed for your server.",
    color: PANEL_COLOR,
  },
  welcome: {
    label: "Welcome Message",
    emoji: "🤗",
    title: "",
    description:
      "🎉 **Welcome to {guildName},**\n**{userMention}**\n\n👤 You are member **#{guildMemberCount}**.\n\nEnjoy your stay!",
    color: "#57F287",
    authorName: "{guildName}",
    authorIcon: "{guildIcon}",
    footer: "Member joined",
    thumbnail: "{userAvatar}",
  },
  leave: {
    label: "Leave Message",
    emoji: "👋",
    title: "",
    description:
      "{userMention}\n\n👋 **{userDisplay}** has left **{guildName}**.\n\n📉 We now have **{guildMemberCount}** members.",
    color: "#ED4245",
    authorName: "{guildName}",
    authorIcon: "{guildIcon}",
    footer: "Member left",
    thumbnail: "{userAvatar}",
  },
  announcement: {
    label: "Announcement",
    emoji: "📢",
    title: "Announcement",
    description:
      "A new announcement has been posted for **{guildName}**.\n\nWrite your announcement here.",
    color: PANEL_COLOR,
    authorName: "{guildName}",
    authorIcon: "{guildIcon}",
    footer: "Announcement",
    thumbnail: "{guildIcon}",
  },
  rules: {
    label: "Rules",
    emoji: "📜",
    title: "Server Rules",
    description:
      "Please read and follow the rules for **{guildName}**.\n\n**1. Be respectful**\nTreat everyone with respect.\n\n**2. No spam**\nDo not spam messages, links, emojis, or mentions.\n\n**3. Keep it appropriate**\nKeep conversations safe and suitable for the server.\n\n**4. No advertising**\nDo not advertise without permission.\n\n**5. Follow Discord Terms**\nFollow Discord’s Terms of Service and Community Guidelines.",
    color: PANEL_COLOR,
    authorName: "{guildName}",
    authorIcon: "{guildIcon}",
    footer: "Please follow the rules",
  },
  suggestion: {
    label: "Suggestion",
    emoji: "💡",
    title: "New Suggestion",
    description:
      "**Suggestion:**\nWrite your suggestion here.\n\n**Status:** Pending review",
    color: "#FEE75C",
    footer: "Suggestion system",
    fields: [
      { name: "Status", value: "Pending", inline: true },
      { name: "Votes", value: "Waiting for votes", inline: true },
    ],
  },
  giveaway: {
    label: "Giveaway",
    emoji: "🎉",
    title: "Giveaway",
    description:
      "**Prize:** Your prize here\n**Winners:** 1\n**Ends:** Soon\n\nEnter the giveaway for a chance to win.",
    color: "#9B59B6",
    footer: "Good luck!",
    fields: [
      { name: "Prize", value: "Your prize here", inline: true },
      { name: "Winners", value: "1", inline: true },
      { name: "Ends", value: "Soon", inline: true },
    ],
  },
  update: {
    label: "Update Post",
    emoji: "📰",
    title: "Server Update",
    description:
      "A new update has been posted for **{guildName}**.\n\n**What changed:**\n- Add update here\n- Add update here\n- Add update here",
    color: "#3498DB",
    footer: "Update notice",
  },
  event: {
    label: "Event",
    emoji: "📅",
    title: "Server Event",
    description:
      "A new event is happening in **{guildName}**.\n\n**Event:** Event name\n**Date:** Date here\n**Time:** Time here\n**Location:** Channel or place here\n\nReact or reply if you are joining.",
    color: "#E67E22",
    footer: "Event details",
    fields: [
      { name: "Date", value: "Set date", inline: true },
      { name: "Time", value: "Set time", inline: true },
      { name: "Location", value: "Set location", inline: true },
    ],
  },
  warning: {
    label: "Warning Notice",
    emoji: "⚠️",
    title: "Warning",
    description:
      "This is an official notice for **{guildName}**.\n\nPlease make sure you follow the server rules.",
    color: "#ED4245",
    footer: "Moderator notice",
  },
};

function discordErrorCode(error) {
  return Number(error?.code || error?.rawError?.code || error?.data?.code || 0);
}
function discordErrorDetail(error) {
  return trim(
    error?.rawError?.message ||
      error?.data?.message ||
      error?.message ||
      "Discord rejected the request.",
    300,
  );
}
function embedOperationError(error, channelId, operation = "send") {
  const code = discordErrorCode(error);
  const detail = discordErrorDetail(error);
  if (code === 50001 || code === 50013) {
    return `❌ Discord denied access to <#${channelId}>. Recheck Goliath's effective channel and category permissions.`;
  }
  if (code === 50035) {
    return `❌ Discord rejected part of the embed or its buttons: ${detail}`;
  }
  if (code === 10008 && operation === "update") {
    return "⚠️ The original embed message no longer exists.";
  }
  return `❌ Discord could not ${operation} the embed${code ? ` (error ${code})` : ""}: ${detail}`;
}
function safeUrl(v) {
  try {
    const text = String(v || "").trim();
    if (!text) return undefined;
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? text : undefined;
  } catch {
    return undefined;
  }
}
function validHex(v) {
  return /^#[0-9A-F]{6}$/i.test(String(v || "").trim());
}
function normHex(v, fallback = PANEL_COLOR) {
  const text = String(v || "").trim();
  return validHex(text) ? text.toUpperCase() : fallback;
}
function isIconUrl(v) {
  return safeUrl(v);
}
function isImageUrl(v) {
  return safeUrl(v);
}
function extractMediaLines(text) {
  return { text: String(text || ""), media: [] };
}
function basePanel(template = "custom") {
  const t = clone(TEMPLATES[template] || TEMPLATES.custom);
  return {
    title: t.title || "",
    description: t.description || "",
    color: t.color || PANEL_COLOR,
    authorName: t.authorName || "",
    authorIcon: t.authorIcon || "",
    authorUrl: t.authorUrl || "",
    footer: t.footer || "",
    footerIcon: t.footerIcon || "",
    thumbnail: t.thumbnail || "",
    image: t.image || "",
    fields: clone(t.fields || []),
    buttons: clone(t.buttons || []),
  };
}
function sync(s) {
  const p = s.panels[s.selectedPanelIndex] || s.panels[0];
  return {
    ...s,
    title: p.title,
    description: p.description,
    color: p.color,
    authorName: p.authorName,
    authorIcon: p.authorIcon,
    authorUrl: p.authorUrl,
    footer: p.footer,
    footerIcon: p.footerIcon,
    thumbnail: p.thumbnail,
    image: p.image,
    fields: p.fields || [],
    buttons: p.buttons || [],
  };
}
function defaultState() {
  const p = basePanel("custom");
  return sync({
    template: "custom",
    selectedPreset: null,
    channelId: null,
    selectedPanelIndex: 0,
    panels: [p],
    allowUserPing: false,
    showTimestamp: true,
    hasUnsavedChanges: false,
    selectedFieldIndex: null,
    selectedButtonIndex: null,
    fieldLayout: "auto",
    deploymentKey: null,
  });
}

embedState.configure({ defaultState, sync, basePanel });

function normalizeInlineFields(fields = []) {
  return fields.map((field) => ({ ...field, inline: !!field.inline }));
}
function applyFieldLayout(fields = [], layout = "auto") {
  const normalized = normalizeInlineFields(fields);
  if (layout === "auto") return normalized;
  if (layout === "1") return normalized.map((f) => ({ ...f, inline: false }));
  return normalized.map((f) => ({ ...f, inline: true }));
}
function buildEmbedFromPanel(panelData, i, showTimestamp = true, fieldLayout = "auto") {
  const e = new EmbedBuilder();
  const title = replaceVars(panelData.title, i);
  const description = replaceVars(panelData.description, i);
  const authorName = replaceVars(panelData.authorName, i);
  const authorIcon = replaceVars(panelData.authorIcon, i);
  const authorUrl = replaceVars(panelData.authorUrl, i);
  const footer = replaceVars(panelData.footer, i);
  const footerIcon = replaceVars(panelData.footerIcon, i);
  const thumbnail = replaceVars(panelData.thumbnail, i);
  const image = replaceVars(panelData.image, i);
  if (title) e.setTitle(trim(title, 256));
  if (description) e.setDescription(trim(description, 4096));
  if (panelData.color && validHex(panelData.color)) e.setColor(panelData.color);
  if (authorName) {
    const author = { name: trim(authorName, 256) };
    if (safeUrl(authorIcon)) author.iconURL = authorIcon;
    if (safeUrl(authorUrl)) author.url = authorUrl;
    e.setAuthor(author);
  }
  if (footer) {
    const f = { text: trim(footer, 2048) };
    if (safeUrl(footerIcon)) f.iconURL = footerIcon;
    e.setFooter(f);
  }
  if (safeUrl(thumbnail)) e.setThumbnail(thumbnail);
  if (safeUrl(image)) e.setImage(image);
  const fields = applyFieldLayout(panelData.fields || [], fieldLayout).slice(0, 25);
  if (fields.length) e.addFields(fields.map((f) => ({ name: trim(replaceVars(f.name, i), 256), value: trim(replaceVars(f.value, i), 1024), inline: !!f.inline })));
  if (showTimestamp) e.setTimestamp();
  return e;
}
function buildPreviewEmbeds(s, i) {
  return s.panels.map((p) => buildEmbedFromPanel(p, i, s.showTimestamp, s.fieldLayout));
}
function buildPreviewEmbed(s, i) {
  return buildEmbedFromPanel(s.panels[s.selectedPanelIndex], i, s.showTimestamp, s.fieldLayout);
}

const EMBED_COMPONENT_LIMITS = Object.freeze({
  maxComponentsPerRow: 5,
  maxActionRows: 5,
});
const MAX_DEPLOYED_BUTTON_ROWS = Math.max(1, Math.min(4, EMBED_COMPONENT_LIMITS.maxActionRows - 1));
function buttonShort(value, max = 500) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
function buttonResolved(value, interaction) {
  try {
    return interaction ? replaceVars(String(value || ""), interaction) : String(value || "");
  } catch {
    return String(value || "");
  }
}
function normalizedButtonStyle(value) {
  const style = String(value || "primary").toLowerCase();
  return ["primary", "secondary", "success", "danger"].includes(style) ? style : "primary";
}
function buttonStyleValue(style) {
  return {
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
  }[normalizedButtonStyle(style)] || ButtonStyle.Primary;
}
function normalizedButtonRow(value) {
  if (value === "" || value == null || value === "auto") return null;
  const row = Number(value);
  return Number.isInteger(row) && row >= 0 && row < MAX_DEPLOYED_BUTTON_ROWS ? row : null;
}
function resolveButtonUrl(value, interaction) {
  const raw = buttonResolved(value, interaction).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
function buttonActionId(button, absoluteIndex) {
  if (button?.id) return String(button.id).trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 100);
  return `embed:action:${absoluteIndex}`;
}
function layoutEmbedButtons(buttons = []) {
  const rows = Array.from({ length: MAX_DEPLOYED_BUTTON_ROWS }, () => []);
  const automatic = [];
  buttons.slice(0, MAX_BUTTONS).forEach((button, index) => {
    const row = normalizedButtonRow(button?.row);
    if (row != null && rows[row].length < EMBED_COMPONENT_LIMITS.maxComponentsPerRow) rows[row].push({ button, index });
    else automatic.push({ button, index });
  });
  for (const entry of automatic) {
    const target = rows.findIndex((row) => row.length < EMBED_COMPONENT_LIMITS.maxComponentsPerRow);
    if (target < 0) break;
    rows[target].push(entry);
  }
  return rows;
}
function buildButtonRows(state, interaction = null) {
  const output = [];
  for (const entries of layoutEmbedButtons(Array.isArray(state?.buttons) ? state.buttons : [])) {
    if (!entries.length) continue;
    const row = new ActionRowBuilder();
    for (const { button, index } of entries) {
      const label = buttonShort(buttonResolved(button?.label || "Button", interaction), 80) || "Button";
      const url = resolveButtonUrl(button?.url, interaction);
      const builder = new ButtonBuilder().setLabel(label);
      if (button?.emoji) builder.setEmoji(button.emoji);
      if (url) builder.setStyle(ButtonStyle.Link).setURL(url);
      else builder.setStyle(buttonStyleValue(button?.style)).setCustomId(buttonActionId(button, index));
      row.addComponents(builder);
    }
    output.push(row);
  }
  return output.slice(0, MAX_DEPLOYED_BUTTON_ROWS);
}
function buttonRows(state, interaction = null) {
  return buildButtonRows(state, interaction);
}
function buildEmbedPanel(interactionOrGuild, memberDisplayName = "Unknown User") {
  const fake = interactionOrGuild?.guild ? interactionOrGuild : { guild: interactionOrGuild, guildId: interactionOrGuild?.id, user: { id: "system" } };
  return buildEditorPanel(fake, memberDisplayName);
}
function mainEmbed(s, who) {
  return new EmbedBuilder()
    .setColor(s.color || PANEL_COLOR)
    .setTitle("✏️ Embed Studio")
    .setDescription([
      "**Build embeds with separate coloured panels in one Discord message.**",
      "",
      `> **Template:** ${(TEMPLATES[s.template] || TEMPLATES.custom).emoji} ${(TEMPLATES[s.template] || TEMPLATES.custom).label}`,
      `> **Preset:** ${s.selectedPreset ? `💾 ${s.selectedPreset}` : "None loaded"}`,
      `> **Channel:** ${s.channelId ? `<#${s.channelId}>` : "Not selected"}`,
      `> **Selected Panel:** ${s.selectedPanelIndex + 1}/${s.panels.length}`,
      `> **Panel Colour:** \`${s.color || PANEL_COLOR}\``,
      `> **Fields:** ${(s.fields || []).length}/25`,
      `> **Buttons:** ${(s.buttons || []).length}/20`,
      `> **Mentions:** ${s.allowUserPing ? "🔔 User ping enabled" : "🔕 Safe / no ping"}`,
      `> **Unsaved Changes:** ${s.hasUnsavedChanges ? "⚠️ Yes" : "✅ No"}`,
      "",
      "Server icon: use **Media → Small thumbnail URL** = `{guildIcon}`. Author/Footer icon fields also accept `{guildIcon}`.",
    ].join("\n"))
    .setFooter({ text: `Requested by ${who}` })
    .setTimestamp();
}
function buildEditorPanel(i, who = "Unknown User") {
  const s = getSession(i);
  return {
    embeds: [mainEmbed(s, who), buildPreviewEmbed(s, i)],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("embed:template").setPlaceholder("🎨 Choose template").addOptions(Object.entries(TEMPLATES).map(([value, t]) => ({ label: t.label, value, emoji: t.emoji, default: s.template === value }))),
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId("embed:channel").setPlaceholder("📢 Choose channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("embed:color").setPlaceholder("🌈 Selected panel colour").addOptions([
          ...COLORS.map((c) => ({ label: c.label, value: c.value, emoji: c.emoji, default: s.color === c.value })),
          { label: "Custom HEX", value: CUSTOM_HEX_VALUE, emoji: "🎨", description: "Enter your own HEX colour" },
        ]),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:builder").setLabel("🛠️ Builder").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:presets").setLabel("💾 Presets").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:use").setLabel("✅ Use Embed").setStyle(ButtonStyle.Success),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("admin:modules").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
function simplePanel(title, desc, state, who) {
  return new EmbedBuilder().setColor(state.color || PANEL_COLOR).setTitle(title).setDescription(desc).setFooter({ text: `Requested by ${who}` }).setTimestamp();
}
function buildBuilderPanel(i, who = "Unknown User") {
  const s = getSession(i);
  const panels = Array.isArray(s.panels) && s.panels.length ? s.panels : [{}];
  return {
    embeds: [simplePanel("🛠️ Embed Builder", `Editing panel **${s.selectedPanelIndex + 1}/${s.panels.length}**.`, s, who), buildPreviewEmbed(s, i)],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("embed:builder-panel-select").setPlaceholder("🧩 Select content panel").setMinValues(1).setMaxValues(1).addOptions(panels.slice(0, 25).map((entry, index) => ({
          label: `${index + 1}. ${trim(entry?.title || entry?.authorName || "Content Panel", 80)}`,
          value: String(index),
          description: trim(entry?.description || entry?.color || "Content panel", 100),
          default: Number(s.selectedPanelIndex || 0) === index,
        }))),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:edit-content").setLabel("✏️ Content").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:panels").setLabel(`🧩 Panels (${s.panels?.length || 1})`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:edit-media").setLabel("🎨 Appearance").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:edit-images").setLabel("🖼️ Media").setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:fields").setLabel(`📋 Fields (${(s.fields || []).length})`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:buttons").setLabel(`🔘 Buttons (${(s.buttons || []).length})`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:update-existing").setLabel("♻️ Update Existing").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:readiness").setLabel("✅ Review").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("embed:test-send").setLabel("🧪 Test").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("embed:toggle-timestamp").setLabel(s.showTimestamp ? "🕒 Timestamp ON" : "🕒 Timestamp OFF").setStyle(s.showTimestamp ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("embed:helpers").setLabel("📖 Variables").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("embed:reset").setLabel("♻️ Reset").setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}
function buildPanelsPanel(i, who) {
  const s = getSession(i);
  return {
    embeds: [simplePanel("🧩 Content Panels", `Selected **${s.selectedPanelIndex + 1}/${s.panels.length}**.`, s, who), buildPreviewEmbed(s, i)],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("embed:panel-select").setPlaceholder("🧩 Select panel").addOptions(s.panels.map((p, n) => ({
          label: `${n + 1}. ${trim(p.title || "Content Panel", 80)}`,
          value: String(n),
          description: trim(p.description || p.color, 100),
          default: s.selectedPanelIndex === n,
        }))),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:panel-add").setLabel("➕ Add").setStyle(ButtonStyle.Success).setDisabled(s.panels.length >= MAX_PANELS),
        new ButtonBuilder().setCustomId("embed:panel-duplicate").setLabel("📋 Duplicate").setStyle(ButtonStyle.Secondary).setDisabled(s.panels.length >= MAX_PANELS),
        new ButtonBuilder().setCustomId("embed:panel-remove").setLabel("🗑️ Remove").setStyle(ButtonStyle.Danger).setDisabled(s.panels.length <= 1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:panel-up").setLabel("⬆️ Up").setStyle(ButtonStyle.Secondary).setDisabled(s.selectedPanelIndex <= 0),
        new ButtonBuilder().setCustomId("embed:panel-down").setLabel("⬇️ Down").setStyle(ButtonStyle.Secondary).setDisabled(s.selectedPanelIndex >= s.panels.length - 1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
function buildFieldsPanel(i, who) {
  const s = getSession(i), rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("embed:field-layout").setPlaceholder("Field Layout").addOptions([
      { label: "Auto", value: "auto", default: (s.fieldLayout || "auto") === "auto" },
      { label: "1 field per row", value: "1", default: s.fieldLayout === "1" },
      { label: "2 fields per row", value: "2", default: s.fieldLayout === "2" },
      { label: "3 fields per row", value: "3", default: s.fieldLayout === "3" },
    ]),
  ));
  if ((s.fields || []).length) rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("embed:field-select").setPlaceholder("📋 Select field").addOptions(s.fields.map((f, n) => ({
      label: `${n + 1}. ${trim(f.name || "Field", 80)}`,
      value: String(n),
      description: trim(f.value || "Value", 100),
      default: s.selectedFieldIndex === n,
    }))),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed:field-add").setLabel("➕ Add").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("embed:field-edit").setLabel("✏️ Edit").setStyle(ButtonStyle.Primary).setDisabled(!Number.isInteger(s.selectedFieldIndex)),
    new ButtonBuilder().setCustomId("embed:field-remove-selected").setLabel("🗑️ Remove").setStyle(ButtonStyle.Danger).setDisabled(!Number.isInteger(s.selectedFieldIndex)),
    new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Builder").setStyle(ButtonStyle.Secondary),
  ));
  return {
    embeds: [simplePanel("📋 Field Management", `Panel ${s.selectedPanelIndex + 1}/${s.panels.length} fields: ${(s.fields || []).length}/25`, s, who)],
    components: rows,
  };
}

function selectedFieldManagerIndex(state) {
  const fields = Array.isArray(state.fields) ? state.fields : [];
  return Number.isInteger(state.selectedFieldIndex) && fields[state.selectedFieldIndex]
    ? state.selectedFieldIndex
    : null;
}
function fieldManagerInput(id, label, style, value = "", maxLength = 4000) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(true)
    .setMaxLength(maxLength)
    .setValue(String(value || "").slice(0, maxLength));
}
function fieldEditorModal(state, index = null) {
  const fields = Array.isArray(state.fields) ? state.fields : [];
  const item = Number.isInteger(index) ? (fields[index] || {}) : {};
  return new ModalBuilder()
    .setCustomId(Number.isInteger(index) ? `embed:field-manager-save:${index}` : "embed:field-manager-save-new")
    .setTitle(Number.isInteger(index) ? "Edit Field" : "Add Field")
    .addComponents(
      new ActionRowBuilder().addComponents(fieldManagerInput("name", "Field name", TextInputStyle.Short, item.name || "", 256)),
      new ActionRowBuilder().addComponents(fieldManagerInput("value", "Field content", TextInputStyle.Paragraph, item.value || "", 1024)),
    );
}
function buildFieldsManagerPanel(interaction) {
  const state = getSession(interaction);
  const fields = Array.isArray(state.fields) ? state.fields : [];
  const index = selectedFieldManagerIndex(state);
  const item = index == null ? null : fields[index];
  const layout = ["auto", "1", "2", "3"].includes(String(state.fieldLayout)) ? String(state.fieldLayout) : "auto";
  const lines = [
    `**Panel:** ${(Number(state.selectedPanelIndex) || 0) + 1} / ${state.panels?.length || 1}`,
    `**Fields:** ${fields.length}/${MAX_EMBED_FIELDS}`,
    `**Layout:** ${layout === "auto" ? "Auto" : `${layout} per row`}`,
    "",
  ];
  if (item) {
    lines.push(
      `**Selected field ${index + 1}:** ${trim(item.name || "Field", 300)}`,
      `**Inline:** ${item.inline ? "Yes" : "No"}`,
      `**Content:** ${trim(item.value || "", 900) || "Not set"}`,
    );
  } else {
    lines.push("**Selected field:** None");
  }
  lines.push(
    "",
    "Field names and content support Embed Studio variables. Use Inline to allow fields to share a row; the Layout setting controls the overall row arrangement.",
  );

  const embeds = [
    new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("📋 Fields")
      .setDescription(lines.join("\n").slice(0, 4096)),
  ];
  if (item) {
    embeds.push(
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("👁️ Selected Field Preview")
        .addFields({
          name: trim(replaceVars(item.name || "Field", interaction), 256) || "Field",
          value: trim(replaceVars(item.value || "", interaction), 1024) || "No content",
          inline: Boolean(item.inline),
        }),
    );
  }

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("embed:field-manager-layout")
        .setPlaceholder("Field layout")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([
          { label: "Auto", value: "auto", description: "Let Embed Studio arrange fields", default: layout === "auto" },
          { label: "1 field per row", value: "1", default: layout === "1" },
          { label: "2 fields per row", value: "2", default: layout === "2" },
          { label: "3 fields per row", value: "3", default: layout === "3" },
        ]),
    ),
  ];

  if (fields.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:field-manager-select")
          .setPlaceholder("Select field")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(fields.map((field, fieldIndex) => ({
            label: `${fieldIndex + 1}. ${trim(field.name || "Field", 80)}`,
            value: String(fieldIndex),
            description: trim(field.value || "No content", 100),
            default: fieldIndex === index,
          }))),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:field-manager-add").setLabel("➕ Add").setStyle(ButtonStyle.Success).setDisabled(fields.length >= MAX_EMBED_FIELDS),
      new ButtonBuilder().setCustomId("embed:field-manager-edit").setLabel("✏️ Edit").setStyle(ButtonStyle.Primary).setDisabled(index == null),
      new ButtonBuilder().setCustomId("embed:field-manager-inline").setLabel(item?.inline ? "↔️ Inline ON" : "↔️ Inline OFF").setStyle(item?.inline ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(index == null),
      new ButtonBuilder().setCustomId("embed:field-manager-remove").setLabel("🗑️ Remove").setStyle(ButtonStyle.Danger).setDisabled(index == null),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:field-manager-up").setLabel("⬆️ Up").setStyle(ButtonStyle.Secondary).setDisabled(index == null || index <= 0),
      new ButtonBuilder().setCustomId("embed:field-manager-down").setLabel("⬇️ Down").setStyle(ButtonStyle.Secondary).setDisabled(index == null || index >= fields.length - 1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds, components: rows.filter(Boolean).slice(0, 5) };
}

function buildButtonsPanel(i, who) {
  const s = getSession(i), rows = [];
  if ((s.buttons || []).length) rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("embed:button-select").setPlaceholder("🔘 Select button").addOptions(s.buttons.map((b, n) => ({
      label: `${n + 1}. ${trim(b.label || "Button", 80)}`,
      value: String(n),
      description: trim(b.url || b.style || "Button", 100),
      default: s.selectedButtonIndex === n,
    }))),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed:button-add").setLabel("➕ Add").setStyle(ButtonStyle.Success).setDisabled((s.buttons || []).length >= MAX_BUTTONS),
    new ButtonBuilder().setCustomId("embed:button-edit").setLabel("✏️ Edit").setStyle(ButtonStyle.Primary).setDisabled(!Number.isInteger(s.selectedButtonIndex)),
    new ButtonBuilder().setCustomId("embed:button-remove-selected").setLabel("🗑️ Remove").setStyle(ButtonStyle.Danger).setDisabled(!Number.isInteger(s.selectedButtonIndex)),
    new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Builder").setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [simplePanel("🔘 Button Management", `Panel ${s.selectedPanelIndex + 1}/${s.panels.length} buttons: ${(s.buttons || []).length}/${MAX_BUTTONS}`, s, who)], components: rows };
}
function selectedButtonManagerIndex(state) {
  const buttons = Array.isArray(state.buttons) ? state.buttons : [];
  return Number.isInteger(state.selectedButtonIndex) && buttons[state.selectedButtonIndex]
    ? state.selectedButtonIndex
    : null;
}
function buttonManagerStyleLabel(style) {
  return { primary: "Primary", secondary: "Secondary", success: "Success", danger: "Danger" }[normalizedButtonStyle(style)];
}
function buttonManagerActionLabel(action) {
  return { reply: "Reply", "toggle-role": "Toggle Role", "add-role": "Add Role", "remove-role": "Remove Role", "user-info": "User Info", "server-info": "Server Info" }[String(action || "").toLowerCase()] || "None";
}
function buttonManagerRowLabel(value) {
  const row = normalizedButtonRow(value);
  return row == null ? "Auto" : `Row ${row + 1}`;
}
function buttonManagerRoleDisplay(interaction, roleId) {
  const role = interaction?.guild?.roles?.cache?.get?.(String(roleId || "").replace(/\D/g, ""));
  return role ? `<@&${role.id}>` : roleId ? `Role ${roleId}` : "Not selected";
}
function buttonManagerDeployedRowFor(buttons, index) {
  const rows = layoutEmbedButtons(buttons);
  const row = rows.findIndex((entries) => entries.some((entry) => entry.index === index));
  return row >= 0 ? row : null;
}
function buildButtonsManagerPanel(interaction) {
  const state = getSession(interaction);
  const buttons = Array.isArray(state.buttons) ? state.buttons : [];
  const index = selectedButtonManagerIndex(state);
  const item = index == null ? null : buttons[index];
  const layout = layoutEmbedButtons(buttons);
  const usedRows = layout.filter((row) => row.length).length;
  const lines = [
    `**Buttons:** ${buttons.length}/${MAX_BUTTONS}`,
    `**Rows used when deployed:** ${usedRows}/${MAX_DEPLOYED_BUTTON_ROWS}`,
    "",
  ];
  if (item) {
    const destination = item.url
      ? `Link: ${trim(item.url, 1000)}`
      : item.action
        ? `Action: ${buttonManagerActionLabel(item.action)}`
        : "No destination configured";
    const actualRow = buttonManagerDeployedRowFor(buttons, index);
    lines.push(
      `**Selected button ${index + 1}:** ${item.emoji ? `${item.emoji} ` : ""}${item.label || "Button"}`,
      `**Style:** ${buttonManagerStyleLabel(item.style)}`,
      `**Destination:** ${destination}`,
      `**Row:** ${buttonManagerRowLabel(item.row)}${actualRow != null ? ` → Row ${actualRow + 1}` : ""}`,
    );
    const action = String(item.action || "").toLowerCase();
    if (["toggle-role", "add-role", "remove-role"].includes(action)) lines.push(`**Role:** ${buttonManagerRoleDisplay(interaction, item.actionValue)}`);
    if (action === "reply" && item.actionValue) lines.push(`**Reply:** ${trim(buttonResolved(item.actionValue, interaction), 900)}`);
  } else {
    lines.push("**Selected button:** None");
  }
  lines.push("", "Buttons support automatic or explicit row placement. Discord limits are enforced: up to 5 buttons per row and up to 20 buttons across 4 button rows.");

  const embeds = [new EmbedBuilder().setColor(0x5865F2).setTitle("🔘 Buttons").setDescription(lines.join("\n").slice(0, 4096))];
  if (item) {
    const previewLabel = trim(buttonResolved(item.label || "Button", interaction), 80) || "Button";
    const previewUrl = safeUrl(buttonResolved(item.url, interaction)) || "";
    const actualRow = buttonManagerDeployedRowFor(buttons, index);
    embeds.push(new EmbedBuilder().setColor(0x5865F2).setTitle("👁️ Selected Button Preview").setDescription([
      `**Label:** ${item.emoji ? `${item.emoji} ` : ""}${previewLabel}`,
      `**Style:** ${previewUrl ? "Link" : buttonManagerStyleLabel(item.style)}`,
      `**Destination:** ${previewUrl ? previewUrl : item.action ? `Action: ${buttonManagerActionLabel(item.action)}` : "Not configured"}`,
      `**Deploy row:** ${actualRow == null ? "Not placed" : actualRow + 1}`,
    ].join("\n").slice(0, 4096)));
  }

  const rows = [];
  if (buttons.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("embed:button-manager-select")
        .setPlaceholder("Select button")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(buttons.map((button, buttonIndex) => ({
          label: `${buttonIndex + 1}. ${trim(button.label || "Button", 80)}`,
          value: String(buttonIndex),
          description: trim(`${buttonManagerRowLabel(button.row)} • ${button.url || buttonManagerActionLabel(button.action) || buttonManagerStyleLabel(button.style)}`, 100),
          default: buttonIndex === index,
        }))),
    ));
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:button-manager-add").setLabel("➕ Add").setStyle(ButtonStyle.Success).setDisabled(buttons.length >= MAX_BUTTONS),
      new ButtonBuilder().setCustomId("embed:button-manager-edit").setLabel("✏️ Edit").setStyle(ButtonStyle.Primary).setDisabled(index == null),
      new ButtonBuilder().setCustomId("embed:button-manager-options").setLabel("⚙️ Options").setStyle(ButtonStyle.Secondary).setDisabled(index == null),
      new ButtonBuilder().setCustomId("embed:button-manager-remove").setLabel("🗑️ Remove").setStyle(ButtonStyle.Danger).setDisabled(index == null),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:button-manager-up").setLabel("⬆️ Up").setStyle(ButtonStyle.Secondary).setDisabled(index == null || index <= 0),
      new ButtonBuilder().setCustomId("embed:button-manager-down").setLabel("⬇️ Down").setStyle(ButtonStyle.Secondary).setDisabled(index == null || index >= buttons.length - 1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
    ),
  );
  return { embeds, components: rows.filter(Boolean).slice(0, EMBED_COMPONENT_LIMITS.maxActionRows) };
}
function buildButtonOptionsPanel(interaction) {
  const state = getSession(interaction);
  const buttons = Array.isArray(state.buttons) ? state.buttons : [];
  const index = selectedButtonManagerIndex(state);
  if (index == null) return buildButtonsManagerPanel(interaction);

  const builtInActions = ["reply", "toggle-role", "add-role", "remove-role", "user-info", "server-info"];
  const roleActions = new Set(["toggle-role", "add-role", "remove-role"]);
  const item = buttons[index];
  const style = normalizedButtonStyle(item.style);
  const action = String(item.action || "").toLowerCase();
  const currentAction = builtInActions.includes(action) ? action : "none";
  const configuredRow = normalizedButtonRow(item.row);
  const actualRow = buttonManagerDeployedRowFor(buttons, index);
  const destination = item.url
    ? `Link: ${trim(item.url, 800)}`
    : action
      ? `Action: ${buttonManagerActionLabel(action)}${builtInActions.includes(action) ? "" : " (unsupported legacy action)"}`
      : "No destination configured";
  const details = [
    `**Button:** ${index + 1} / ${buttons.length}`,
    `**Label:** ${item.label || "Button"}`,
    `**Style:** ${buttonManagerStyleLabel(style)}`,
    `**Destination:** ${destination}`,
    `**Layout:** ${buttonManagerRowLabel(item.row)}${actualRow != null ? ` → deploys on Row ${actualRow + 1}` : ""}`,
  ];
  if (roleActions.has(action)) details.push(`**Role:** ${buttonManagerRoleDisplay(interaction, item.actionValue)}`);
  if (action === "reply") details.push(`**Reply:** ${item.actionValue ? trim(buttonResolved(item.actionValue, interaction), 900) : "Not configured"}`);
  details.push("", "Choose the action and row placement below. Auto placement fills the first available row. A Discord button row can never contain more than 5 buttons.");

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:button-style:primary").setLabel("🔵 Primary").setStyle(style === "primary" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("embed:button-style:secondary").setLabel("⚪ Secondary").setStyle(style === "secondary" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("embed:button-style:success").setLabel("🟢 Success").setStyle(style === "success" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("embed:button-style:danger").setLabel("🔴 Danger").setStyle(style === "danger" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("embed:button-action-select").setPlaceholder("Choose button action").setMinValues(1).setMaxValues(1).addOptions([
        { label: "No Action / Link", value: "none", description: "Use no bot action; optionally configure a link", default: currentAction === "none" },
        { label: "Reply", value: "reply", description: "Send the clicker an ephemeral reply", default: currentAction === "reply" },
        { label: "Toggle Role", value: "toggle-role", description: "Add or remove the selected role", default: currentAction === "toggle-role" },
        { label: "Add Role", value: "add-role", description: "Give the selected role", default: currentAction === "add-role" },
        { label: "Remove Role", value: "remove-role", description: "Remove the selected role", default: currentAction === "remove-role" },
        { label: "User Info", value: "user-info", description: "Show the clicker their Discord information", default: currentAction === "user-info" },
        { label: "Server Info", value: "server-info", description: "Show information about this server", default: currentAction === "server-info" },
      ]),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("embed:button-row-select").setPlaceholder("Choose button row").setMinValues(1).setMaxValues(1).addOptions([
        { label: "Auto placement", value: "auto", description: "Fill the first available row automatically", default: configuredRow == null },
        ...Array.from({ length: MAX_DEPLOYED_BUTTON_ROWS }, (_, row) => ({
          label: `Row ${row + 1}`,
          value: String(row),
          description: `Place this button on Discord button row ${row + 1}`,
          default: configuredRow === row,
        })),
      ]),
    ),
  ];
  if (roleActions.has(action)) {
    rows.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId("embed:button-action-role").setPlaceholder("Select role for this button").setMinValues(1).setMaxValues(1),
    ));
  } else if (action === "reply") {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("embed:button-reply-edit").setLabel("✏️ Reply Text").setStyle(ButtonStyle.Primary),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed:button-options-back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
  ));

  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle("⚙️ Button Options").setDescription(details.join("\n").slice(0, 4096))],
    components: rows.filter(Boolean).slice(0, EMBED_COMPONENT_LIMITS.maxActionRows),
  };
}
function cleanPresetName(value) {
  return String(value || "").trim().slice(0, 50);
}
function buildPresetsPanel(i, presets = null, defaultName = null) {
  const s = getSession(i), rows = [];
  const guildId = i?.guildId || i?.guild?.id || null;
  const resolvedPresets = presets && typeof presets === "object" && !Array.isArray(presets)
    ? presets
    : (guildId && typeof guildManager.getEmbedPresets === "function" ? guildManager.getEmbedPresets(guildId) || {} : {});
  const resolvedDefault = defaultName != null
    ? defaultName
    : (guildId && typeof guildManager.getEmbedDefaults === "function"
      ? (guildManager.getEmbedDefaults(guildId) || {})[s.template || "custom"] || null
      : null);
  const entries = Object.entries(resolvedPresets || {}).slice(0, 25);
  if (entries.length) rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("embed:preset-select")
      .setPlaceholder("💾 Select preset")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(entries.map(([key, preset]) => ({
        label: (cleanPresetName(preset?.name || key) || key).slice(0, 100),
        value: key.slice(0, 100),
        description: resolvedDefault === key ? "Default preset" : "Saved preset",
        default: s.selectedPreset === key,
      }))),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed:preset-load").setLabel("📂 Load").setStyle(ButtonStyle.Primary).setDisabled(!s.selectedPreset),
    new ButtonBuilder().setCustomId("embed:preset-save").setLabel("💾 Save Current").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("embed:preset-new").setLabel("➕ New").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed:preset-rename").setLabel("✏️ Rename").setStyle(ButtonStyle.Secondary).setDisabled(!s.selectedPreset),
    new ButtonBuilder().setCustomId("embed:preset-duplicate").setLabel("📄 Duplicate").setStyle(ButtonStyle.Secondary).setDisabled(!s.selectedPreset),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed:preset-delete").setLabel("🗑️ Delete").setStyle(ButtonStyle.Danger).setDisabled(!s.selectedPreset),
    new ButtonBuilder().setCustomId("embed:preset-default").setLabel("⭐ Set Default").setStyle(ButtonStyle.Secondary).setDisabled(!s.selectedPreset),
    new ButtonBuilder().setCustomId("embed:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [simplePanel("💾 Embed Presets", `Saved presets: ${entries.length}.\nDefault: ${resolvedDefault || "None"}.`, s, memberName(i))], components: rows.slice(0, 5) };
}
function buildHelpersPanel(i) {
  const s = getSession(i);
  return { embeds: [simplePanel("📖 Embed Variables", HELPERS.map((h) => `\`${h}\``).join("\n"), s, memberName(i))], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Builder").setStyle(ButtonStyle.Secondary))] };
}
function readinessOptions() {
  const { mediaModel } = require("./embedMedia");
  return {
    mediaForPanel: mediaModel.mediaForPanel,
    maxGalleryItems: mediaModel.MAX_GALLERY_ITEMS,
    maxFiles: mediaModel.MAX_FILES,
    helpers: HELPERS,
  };
}
function getReadinessReportCanonical(interaction, state = getSession(interaction)) {
  const { getReadinessReport } = require("./embedValidation");
  return getReadinessReport(interaction, state, readinessOptions());
}
function getReadinessFixTargetCanonical(report) {
  const { getReadinessFixTarget } = require("./embedValidation");
  return getReadinessFixTarget(report);
}
function buildReadinessPanel(interaction) {
  const state = getSession(interaction);
  const { buildReadinessModel } = require("./embedValidation");
  const model = buildReadinessModel(interaction, state, readinessOptions());
  const { report, fix, lines } = model;
  const first = report.ready
    ? new ButtonBuilder().setCustomId("embed:readiness-refresh").setLabel("🔄 Recheck").setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder().setCustomId("embed:readiness-fix").setLabel(fix.label).setStyle(ButtonStyle.Primary);
  const row1 = new ActionRowBuilder().addComponents(
    first,
    new ButtonBuilder().setCustomId("embed:use").setLabel("✅ Use Embed").setStyle(ButtonStyle.Success).setDisabled(!report.ready),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed:update-existing").setLabel("♻️ Update Existing").setStyle(ButtonStyle.Secondary).setDisabled(!report.ready),
    new ButtonBuilder().setCustomId("embed:test-send").setLabel("🧪 Test").setStyle(ButtonStyle.Secondary).setDisabled(!report.ready),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(report.ready ? (report.warnings.length ? 0xFEE75C : 0x57F287) : 0xED4245)
        .setTitle("✅ Embed Readiness")
        .setDescription(lines.join("\n").slice(0, 4096))
        .setFooter({ text: `Requested by ${memberName(interaction)}` })
        .setTimestamp(),
    ],
    components: [row1, row2, row3],
  };
}
function modal(id, title, inputs) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...inputs.map((input) => new ActionRowBuilder().addComponents(input)));
}
function input(id, label, style, value = "", required = false, max) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setValue(trim(value, max || 4000));
  if (max) t.setMaxLength(max);
  return t;
}
function contentModal(s) {
  return modal(`embed:save-content:${Date.now()}`, "Edit Panel Text", [
    input("title", "Panel title", TextInputStyle.Short, s.title, false, 256),
    input("description", "Panel message/content", TextInputStyle.Paragraph, s.description, false, 4000),
    input("authorName", "Author name", TextInputStyle.Short, s.authorName, false, 256),
    input("footer", "Footer text", TextInputStyle.Short, s.footer, false, 2048),
  ]);
}
function mediaModal(s) {
  return modal(`embed:save-media:${Date.now()}`, "Edit Panel Media", [
    input("authorIcon", "Author logo URL / variable", TextInputStyle.Short, s.authorIcon),
    input("thumbnail", "Small thumbnail URL / variable", TextInputStyle.Short, s.thumbnail),
    input("image", "Large banner/image URL", TextInputStyle.Short, s.image),
    input("authorUrl", "Author clickable URL", TextInputStyle.Short, s.authorUrl),
    input("footerIcon", "Footer icon URL / variable", TextInputStyle.Short, s.footerIcon),
  ]);
}
function fieldModal(s, n = null) {
  const f = Number.isInteger(n) ? s.fields[n] : {};
  return modal(Number.isInteger(n) ? `embed:field-save:${n}` : "embed:field-save-new", Number.isInteger(n) ? "Edit Field" : "Add Field", [
    input("name", "Field name", TextInputStyle.Short, f.name, true, 256),
    input("value", "Field value", TextInputStyle.Paragraph, f.value, true, 1024),
    input("layout", "Inline? yes/no", TextInputStyle.Short, f.inline ? "yes" : "no", false, 10),
  ]);
}
function buttonModal(s, n = null) {
  const b = Number.isInteger(n) ? s.buttons[n] : { style: "Link" };
  return modal(Number.isInteger(n) ? `embed:button-save:${n}` : "embed:button-save-new", Number.isInteger(n) ? "Edit Button" : "Add Button", [
    input("label", "Button Label", TextInputStyle.Short, b.label, true, 80),
    input("emoji", "Emoji", TextInputStyle.Short, b.emoji, false, 20),
    input("style", "Style", TextInputStyle.Short, b.style || "Link"),
    input("url", "URL", TextInputStyle.Short, b.url),
  ]);
}
function buttonEditorModal(state, index = null) {
  const buttons = Array.isArray(state.buttons) ? state.buttons : [];
  const item = Number.isInteger(index) ? (buttons[index] || {}) : {};
  return modal(
    Number.isInteger(index) ? `embed:button-manager-save:${index}` : "embed:button-manager-save-new",
    Number.isInteger(index) ? "Edit Button" : "Add Button",
    [
      input("label", "Button label", TextInputStyle.Short, item.label || "", true, 80),
      input("emoji", "Emoji (optional)", TextInputStyle.Short, item.emoji || "", false, 100),
      input("url", "Link URL / variable (optional)", TextInputStyle.Short, item.url || "", false, 4000),
    ],
  );
}
function buttonReplyModal(state) {
  const buttons = Array.isArray(state.buttons) ? state.buttons : [];
  const index = Number.isInteger(state.selectedButtonIndex) && buttons[state.selectedButtonIndex]
    ? state.selectedButtonIndex
    : null;
  const item = index == null ? {} : (buttons[index] || {});
  return modal("embed:button-reply-save", "Button Reply Text", [
    input("replyText", "Reply text / variables", TextInputStyle.Paragraph, item.actionValue || "", true, 1000),
  ]);
}
function colorModal(s) {
  return modal("embed:save-color", "Custom HEX Colour", [input("hex", "HEX colour", TextInputStyle.Short, s.color || PANEL_COLOR, true, 7)]);
}
function presetModal(s) {
  return modal("embed:preset-save-modal", "Save Embed Preset", [input("name", "Preset name", TextInputStyle.Short, s.selectedPreset || "", true, 50)]);
}
function resolveAppearanceSource(source, interaction) {
  const raw = String(source || "").trim();
  if (!raw) return "";
  try {
    const resolved = replaceVars(raw, interaction);
    const url = new URL(String(resolved || "").trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
function appearanceDetailsModal(state) {
  return new ModalBuilder()
    .setCustomId(`embed:appearance-details-save:${Date.now()}`)
    .setTitle("Edit Appearance Details")
    .addComponents(
      new ActionRowBuilder().addComponents(input("authorName", "Author name", TextInputStyle.Short, state.authorName, false, 256)),
      new ActionRowBuilder().addComponents(input("authorUrl", "Author clickable URL", TextInputStyle.Short, state.authorUrl, false, 4000)),
      new ActionRowBuilder().addComponents(input("footer", "Footer text", TextInputStyle.Short, state.footer, false, 2048)),
    );
}
function appearanceIconUrlModal(kind, state) {
  const isAuthor = kind === "author";
  const value = isAuthor ? state.authorIcon : state.footerIcon;
  return new ModalBuilder()
    .setCustomId(`embed:appearance-icon-url-save:${kind}:${Date.now()}`)
    .setTitle(isAuthor ? "Author Icon URL" : "Footer Icon URL")
    .addComponents(new ActionRowBuilder().addComponents(
      input("source", `${isAuthor ? "Author" : "Footer"} icon URL / variable`, TextInputStyle.Short, value, false, 4000),
    ));
}
function appearanceIconUploadModal(kind) {
  const isAuthor = kind === "author";
  return new ModalBuilder()
    .setCustomId(`embed:appearance-icon-upload-save:${kind}`)
    .setTitle(isAuthor ? "Upload Author Icon" : "Upload Footer Icon")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(isAuthor ? "Author icon image" : "Footer icon image")
        .setDescription("Upload one image. Discord-supported image formats are preserved.")
        .setFileUploadComponent(new FileUploadBuilder().setCustomId("icon_file").setMinValues(1).setMaxValues(1).setRequired(true)),
    );
}
function buildAppearancePanel(interaction) {
  const state = getSession(interaction);
  const authorIcon = resolveAppearanceSource(state.authorIcon, interaction);
  const footerIcon = resolveAppearanceSource(state.footerIcon, interaction);
  const lines = [
    `**Author name:** ${state.authorName ? trim(state.authorName, 300) : "Not set"}`,
    `**Author link:** ${state.authorUrl ? trim(state.authorUrl, 500) : "Not set"}`,
    `**Author icon:** ${state.authorIcon ? trim(state.authorIcon, 500) : "Not set"}`,
    "",
    `**Footer text:** ${state.footer ? trim(state.footer, 700) : "Not set"}`,
    `**Footer icon:** ${state.footerIcon ? trim(state.footerIcon, 500) : "Not set"}`,
    "",
    "Icon sources can use direct HTTPS image links, Embed Studio variables, or direct uploads.",
  ];
  const embeds = [new EmbedBuilder().setColor(0x5865F2).setTitle("🎨 Appearance").setDescription(lines.join("\n").slice(0, 4096))];
  if (authorIcon) embeds.push(new EmbedBuilder().setColor(0x5865F2).setTitle("👤 Author Icon Preview").setThumbnail(authorIcon));
  if (footerIcon) embeds.push(new EmbedBuilder().setColor(0x5865F2).setTitle("🏷️ Footer Icon Preview").setThumbnail(footerIcon));
  return {
    embeds,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:appearance-details").setLabel("✏️ Edit Details").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("embed:appearance-author-icon").setLabel("👤 Author Icon").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("embed:appearance-footer-icon").setLabel("🏷️ Footer Icon").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:builder").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
function buildAppearanceIconPanel(interaction, kind) {
  const state = getSession(interaction);
  const isAuthor = kind === "author";
  const raw = isAuthor ? state.authorIcon : state.footerIcon;
  const resolved = resolveAppearanceSource(raw, interaction);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(isAuthor ? "👤 Author Icon" : "🏷️ Footer Icon")
    .setDescription([
      `**Source:** ${raw ? trim(raw, 1000) : "Not set"}`,
      "",
      "Use a direct HTTPS image URL, an Embed Studio variable, or upload an image directly.",
    ].join("\n"));
  if (resolved) embed.setThumbnail(resolved);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`embed:appearance-icon-url:${kind}`).setLabel("✏️ Edit URL").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`embed:appearance-icon-upload:${kind}`).setLabel("📤 Upload").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`embed:appearance-icon-clear:${kind}`).setLabel("🗑️ Clear").setStyle(ButtonStyle.Danger).setDisabled(!raw),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("embed:appearance-back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

module.exports = {
  clone,
  trim,
  discordErrorCode,
  discordErrorDetail,
  embedOperationError,
  safeUrl,
  validHex,
  normHex,
  fmtDate,
  fmtTs,
  avatar,
  guildIcon,
  guildBanner,
  memberName,
  displayName,
  refreshGuild,
  sessionKey,
  replaceVars,
  isIconUrl,
  isImageUrl,
  extractMediaLines,
  basePanel,
  sync,
  saveSelected,
  defaultState,
  getSession,
  saveSession,
  markUnsaved,
  clearUnsaved,
  resetSession,
  allowedMentions,
  presetData,
  applyTemplate,
  applyPreset,
  setDefault,
  normalizeInlineFields,
  applyFieldLayout,
  buildEmbedFromPanel,
  buildPreviewEmbeds,
  buildPreviewEmbed,
  buttonRows,
  buildButtonRows,
  layoutEmbedButtons,
  embedButtonRow: normalizedButtonRow,
  buildEmbedPanel,
  mainEmbed,
  buildEditorPanel,
  simplePanel,
  buildBuilderPanel,
  buildPanelsPanel,
  buildFieldsPanel,
  buildFieldsManagerPanel,
  fieldEditorModal,
  buildButtonsPanel,
  buildButtonsManagerPanel,
  buildButtonOptionsPanel,
  buildPresetsPanel,
  buildHelpersPanel,
  buildReadinessPanel,
  getReadinessReport: getReadinessReportCanonical,
  getReadinessFixTarget: getReadinessFixTargetCanonical,
  modal,
  input,
  contentModal,
  mediaModal,
  fieldModal,
  buttonModal,
  buttonEditorModal,
  buttonReplyModal,
  colorModal,
  presetModal,
  appearanceDetailsModal,
  appearanceIconUrlModal,
  appearanceIconUploadModal,
  buildAppearancePanel,
  buildAppearanceIconPanel,
  PANEL_COLOR,
  CUSTOM_HEX_VALUE,
  MAX_PANELS,
  MAX_BUTTONS,
  MAX_EMBED_FIELDS,
  EMBED_COMPONENT_LIMITS,
  MAX_DEPLOYED_BUTTON_ROWS,
  COLORS,
  TEMPLATES,
  HELPERS,
};
