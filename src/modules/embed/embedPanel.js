const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const {
  saveEmbedDeployment,
  getEmbedDeployment,
  getDeploymentKeyFromState,
} = require("./embedDeploymentStore");

const guildManager = require("../../core/guild/guildManager");

const PANEL_COLOR = "#5865F2";
const CUSTOM_HEX_VALUE = "__custom_hex__";
const MAX_PANELS = 10;
const MAX_BUTTONS = 20;
const sessions = new Map();

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
      "**Suggestion:**\nWrite the suggestion here.\n\n**Status:** Pending review",
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

const HELPERS = [
  "{userId}",
  "{userTag}",
  "{userName}",
  "{userGlobalName}",
  "{userMention}",
  "{userNoPing}",
  "{userAvatar}",
  "{userServerAvatar}",
  "{userNickname}",
  "{userDisplay}",
  "{userCreatedAt}",
  "{userCreatedTimestamp}",
  "{userJoinedAt}",
  "{userJoinedTimestamp}",
  "{nowTimestamp}",
  "{successEmoji}",
  "{warningEmoji}",
  "{errorEmoji}",
  "{proofVerifiedEmoji}",
  "{successColor}",
  "{warningColor}",
  "{errorColor}",
  "{proofVerifiedColor}",
  "{guildId}",
  "{guildName}",
  "{server}",
  "{guildIcon}",
  "{serverIcon}",
  "{guildBanner}",
  "{guildMemberCount}",
  "{memberCount}",
  "{guildVanityCode}",
];

function clone(v) {
  return JSON.parse(JSON.stringify(v || {}));
}
function trim(v, max = 4096) {
  v = String(v || "");
  return v.length > max ? `${v.slice(0, max - 3)}...` : v;
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
  return /^#?[0-9A-Fa-f]{6}$/.test(String(v || "").trim());
}
function normHex(v) {
  return `#${String(v || "")
    .trim()
    .replace("#", "")
    .toUpperCase()}`;
}
function fmtDate(v) {
  try {
    return v ? new Date(v).toLocaleString() : "";
  } catch {
    return "";
  }
}
function fmtTs(v) {
  const s = Math.floor(Number(v) / 1000);
  return Number.isFinite(s) ? `<t:${s}:R>` : "";
}
function avatar(e) {
  return e?.displayAvatarURL?.({ extension: "png", size: 256 }) || "";
}
function guildIcon(g) {
  return g?.iconURL?.({ extension: "png", size: 256 }) || "";
}
function guildBanner(g) {
  return g?.bannerURL?.({ extension: "png", size: 1024 }) || "";
}
function memberName(i) {
  return (
    i.member?.displayName ||
    i.user?.displayName ||
    i.user?.username ||
    "Unknown User"
  );
}
function displayName(i) {
  return (
    i.member?.displayName ||
    i.user?.globalName ||
    i.user?.displayName ||
    i.user?.username ||
    "User"
  );
}
function refreshGuild(id) {
  if (typeof guildManager.reloadGuild === "function")
    guildManager.reloadGuild(id);
}
function sessionKey(i) {
  return `${i.guildId}:${i.user.id}`;
}

function replaceVars(text, i) {
  const user = i.user || {},
    member = i.member || {},
    guild = i.guild || {};
  const userId = user.id || "",
    userAvatar = avatar(user),
    serverAvatar = avatar(member) || userAvatar;
  const icon = guildIcon(guild),
    banner = guildBanner(guild),
    now = `<t:${Math.floor(Date.now() / 1000)}:R>`;
  const vars = {
    userId,
    userid: userId,
    userTag: user.tag || user.username || "User",
    usertag: user.tag || user.username || "User",
    userName: user.username || "User",
    username: user.username || "User",
    userGlobalName: user.globalName || user.username || "User",
    userglobalname: user.globalName || user.username || "User",
    userMention: userId ? `<@${userId}>` : "",
    usermention: userId ? `<@${userId}>` : "",
    userNoPing: userId ? `<@${userId}>` : "",
    usernoping: userId ? `<@${userId}>` : "",
    user: userId ? `<@${userId}>` : "",
    userAvatar,
    useravatar: userAvatar,
    useravatarurl: userAvatar,
    userServerAvatar: serverAvatar,
    userserveravatar: serverAvatar,
    userserveravatarurl: serverAvatar,
    userNickname: member.nickname || displayName(i),
    usernickname: member.nickname || displayName(i),
    userDisplay: displayName(i),
    userdisplay: displayName(i),
    userdisplayname: displayName(i),
    userCreatedAt: fmtDate(user.createdAt),
    usercreatedat: fmtDate(user.createdAt),
    userCreatedTimestamp: fmtTs(user.createdTimestamp),
    usercreatedtimestamp: fmtTs(user.createdTimestamp),
    userJoinedAt: fmtDate(member.joinedAt),
    userjoinedat: fmtDate(member.joinedAt),
    userJoinedTimestamp: fmtTs(member.joinedTimestamp),
    userjoinedtimestamp: fmtTs(member.joinedTimestamp),
    nowTimestamp: now,
    nowtimestamp: now,
    successEmoji: "✅",
    succesemoji: "✅",
    successemoji: "✅",
    warningEmoji: "⚠️",
    warningemoji: "⚠️",
    errorEmoji: "❌",
    erroremoji: "❌",
    proofVerifiedEmoji: "💎",
    proofverifiedemoji: "💎",
    successColor: "#57F287",
    successcolor: "#57F287",
    warningColor: "#FEE75C",
    warningcolor: "#FEE75C",
    errorColor: "#ED4245",
    errorcolor: "#ED4245",
    proofVerifiedColor: "#00D4FF",
    proofverifiedcolor: "#00D4FF",
    guildId: guild.id || "",
    guildid: guild.id || "",
    guildName: guild.name || "Server",
    guildname: guild.name || "Server",
    server: guild.name || "Server",
    guildIcon: icon,
    guildicon: icon,
    guildiconurl: icon,
    serverIcon: icon,
    servericon: icon,
    servericonurl: icon,
    guildBanner: banner,
    guildbanner: banner,
    guildbannerurl: banner,
    guildMemberCount: String(guild.memberCount || 0),
    guildmembercount: String(guild.memberCount || 0),
    memberCount: String(guild.memberCount || 0),
    membercount: String(guild.memberCount || 0),
    guildVanityCode: guild.vanityURLCode || "",
    guildvanitycode: guild.vanityURLCode || "",
  };
  let out = String(text || "");
  Object.entries(vars).forEach(([k, v]) => {
    out = out.replaceAll(`{${k}}`, v);
  });
  return out;
}

function isIconUrl(url) {
  return /\/icons\/|\/avatars\//i.test(String(url || ""));
}
function isImageUrl(url) {
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
function extractMediaLines(description) {
  const lines = String(description || "").split("\n");
  const kept = [];
  let thumbnailUrl = null;
  let imageUrl = null;

  for (const line of lines) {
    const text = line.trim();
    const url = safeUrl(text);

    if (url && isImageUrl(url)) {
      if (isIconUrl(url) && !thumbnailUrl) {
        thumbnailUrl = url;
        continue;
      }

      if (!isIconUrl(url) && !imageUrl) {
        imageUrl = url;
        continue;
      }
    }

    kept.push(line);
  }

  return { description: kept.join("\n").trim(), thumbnailUrl, imageUrl };
}

function basePanel(data = {}) {
  return {
    title: data.title || "",
    description: data.description || "",
    color: data.color || PANEL_COLOR,
    authorName: data.authorName || "",
    authorIcon: data.authorIcon || "",
    authorUrl: data.authorUrl || "",
    footer: data.footer || "",
    footerIcon: data.footerIcon || "",
    image: data.image || "",
    thumbnail: data.thumbnail || "",
    fields: Array.isArray(data.fields) ? clone(data.fields).slice(0, 25) : [],
  };
}
function sync(state) {
  const panels =
    Array.isArray(state.panels) && state.panels.length
      ? state.panels.map(basePanel).slice(0, MAX_PANELS)
      : [basePanel(state)];
  const selectedPanelIndex = Math.max(
    0,
    Math.min(Number(state.selectedPanelIndex) || 0, panels.length - 1),
  );
  return {
    ...state,
    panels,
    selectedPanelIndex,
    ...panels[selectedPanelIndex],
  };
}
function saveSelected(state, patch = {}) {
  const s = sync(state);
  const panels = s.panels.map((p, n) =>
    n === s.selectedPanelIndex ? basePanel({ ...p, ...patch }) : p,
  );
  return sync({ ...s, panels });
}
function defaultState() {
  const p = basePanel(TEMPLATES.custom);
  return {
    template: "custom",
    selectedPreset: null,
    showTimestamp: true,
    fieldLayout: "auto",
    selectedPanelIndex: 0,
    selectedFieldIndex: null,
    selectedButtonIndex: null,
    channelId: null,
    hasUnsavedChanges: false,
    allowUserPing: false,
    panels: [p],
    buttons: [],
    ...p,
  };
}
function getSession(i) {
  if (!sessions.has(sessionKey(i))) sessions.set(sessionKey(i), defaultState());
  return sync(sessions.get(sessionKey(i)));
}
function saveSession(i, state) {
  const s = sync(state);
  sessions.set(sessionKey(i), s);
  return s;
}
function markUnsaved(i, state) {
  return saveSession(i, { ...state, hasUnsavedChanges: true });
}
function clearUnsaved(i, state) {
  return saveSession(i, { ...state, hasUnsavedChanges: false });
}
function resetSession(i) {
  return saveSession(i, defaultState());
}
function allowedMentions(state, i) {
  return state.allowUserPing
    ? { users: [i.user.id], roles: [], repliedUser: false }
    : { parse: [], repliedUser: false };
}
function presetData(state) {
  const s = sync(state);
  return {
    template: s.template || "custom",
    channelId: s.channelId || null,
    allowUserPing: Boolean(s.allowUserPing),
    showTimestamp: s.showTimestamp !== false,
    fieldLayout: s.fieldLayout || "auto",
    panels: clone(s.panels),
    buttons: clone(s.buttons || []),
    ...s.panels[s.selectedPanelIndex],
  };
}
function applyTemplate(i, name) {
  const t = TEMPLATES[name] || TEMPLATES.custom,
    current = getSession(i),
    p = basePanel(t);
  return saveSession(i, {
    ...current,
    template: name,
    selectedPreset: null,
    selectedPanelIndex: 0,
    selectedFieldIndex: null,
    panels: [p],
    buttons: clone(t.buttons || []),
    ...p,
    hasUnsavedChanges: true,
  });
}
function applyPreset(i, name, preset) {
  const current = getSession(i);
  const panels =
    Array.isArray(preset.panels) && preset.panels.length
      ? preset.panels.map(basePanel)
      : [basePanel(preset)];
  return clearUnsaved(i, {
    ...current,
    template: preset.template || "custom",
    selectedPreset: name,
    selectedPanelIndex: 0,
    selectedFieldIndex: null,
    panels,
    buttons: clone(preset.buttons || []),
    channelId: preset.channelId || current.channelId,
    allowUserPing: Boolean(preset.allowUserPing),
    showTimestamp: preset.showTimestamp !== false,
    fieldLayout: preset.fieldLayout || current.fieldLayout || "auto",
  });
}
function setDefault(guildId, template, preset) {
  if (typeof guildManager.setEmbedDefaultPreset === "function") {
    guildManager.setEmbedDefaultPreset(guildId, template, preset);
    return true;
  }
  if (typeof guildManager.setEmbedDefault === "function") {
    guildManager.setEmbedDefault(guildId, template, preset);
    return true;
  }
  if (typeof guildManager.replaceGuildSection === "function") {
    const current =
      typeof guildManager.getEmbedDefaults === "function"
        ? guildManager.getEmbedDefaults(guildId) || {}
        : {};
    guildManager.replaceGuildSection(guildId, "embedDefaults", {
      ...current,
      [template]: preset,
    });
    return true;
  }
  return false;
}

function normalizeInlineFields(fields) {
  let inlineCount = 0;

  return fields.map((field) => {
    if (!field.inline) {
      inlineCount = 0;
      return { ...field, inline: false };
    }

    inlineCount += 1;

    if (inlineCount > 2) {
      inlineCount = 1;
      return { ...field, inline: false };
    }

    return { ...field, inline: true };
  });
}

function applyFieldLayout(fields, layout = "auto") {
  if (layout === "1") return fields.map((field) => ({ ...field, inline: false }));
  if (layout === "3") return fields;

  const inlineCount = fields.filter((field) => field.inline).length;
  const useTwoPerRow = layout === "2" || (layout === "auto" && (inlineCount === 4 || inlineCount === 5));

  if (!useTwoPerRow) return fields;

  const output = [];
  let rowCount = 0;

  fields.forEach((field, index) => {
    if (!field.inline) {
      rowCount = 0;
      output.push(field);
      return;
    }

    output.push({ ...field, inline: true });
    rowCount += 1;

    const hasMoreInline = fields.slice(index + 1).some((next) => next.inline);
    if (rowCount === 2 && hasMoreInline) {
      output.push({ name: "\u200B", value: "\u200B", inline: true });
      rowCount = 0;
    }
  });

  return output.slice(0, 25);
}

function buildEmbedFromPanel(p, i, showTimestamp, fieldLayout = "auto") {
  const e = new EmbedBuilder().setColor(p.color || PANEL_COLOR);

  const authorName = trim(replaceVars(p.authorName, i), 256);
  const authorIcon = safeUrl(replaceVars(p.authorIcon, i));
  const authorUrl = safeUrl(replaceVars(p.authorUrl, i));

  if (authorName || (authorIcon && isImageUrl(authorIcon))) {
    e.setAuthor({
      name: authorName || replaceVars("{guildName}", i) || "Embed",
      ...(authorIcon && isImageUrl(authorIcon) ? { iconURL: authorIcon } : {}),
      ...(authorUrl ? { url: authorUrl } : {}),
    });
  }

  if (p.title) e.setTitle(trim(replaceVars(p.title, i), 256));

  const media = extractMediaLines(replaceVars(p.description, i));
  if (media.description) e.setDescription(trim(media.description, 4096));

  const footer = trim(replaceVars(p.footer, i), 2048);
  const footerIcon = safeUrl(replaceVars(p.footerIcon, i));

  if (footer) {
    e.setFooter({
      text: footer,
      ...(footerIcon && isImageUrl(footerIcon) ? { iconURL: footerIcon } : {}),
    });
  } else if (footerIcon && isImageUrl(footerIcon)) {
    e.setFooter({
      text: replaceVars("{guildName}", i) || "Embed",
      iconURL: footerIcon,
    });
  }

  const image = safeUrl(replaceVars(p.image, i));
  const thumb = safeUrl(replaceVars(p.thumbnail, i));

  if (image && isImageUrl(image)) e.setImage(image);
  else if (media.imageUrl) e.setImage(media.imageUrl);

  if (thumb && isImageUrl(thumb)) e.setThumbnail(thumb);
  else if (media.thumbnailUrl) e.setThumbnail(media.thumbnailUrl);

  const fields = applyFieldLayout(
    (p.fields || [])
      .filter((f) => f?.name && f?.value)
      .slice(0, 25)
      .map((f) => ({
        name: trim(replaceVars(f.name, i), 256),
        value: trim(replaceVars(f.value, i), 1024),
        inline: Boolean(f.inline),
      })),
    fieldLayout,
  );

  if (fields.length) e.addFields(fields);
  if (showTimestamp !== false) e.setTimestamp();

  return e;
}
function buildPreviewEmbeds(state, i) {
  const s = sync(state);
  return s.panels
    .slice(0, MAX_PANELS)
    .map((p) => buildEmbedFromPanel(p, i, s.showTimestamp, s.fieldLayout || "auto"));
}
function buildPreviewEmbed(state, i) {
  return buildPreviewEmbeds(state, i)[0];
}
function buttonRows(state) {
  const rows = [],
    buttons = (state.buttons || []).slice(0, MAX_BUTTONS);
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder();
    buttons.slice(i, i + 5).forEach((b, offset) => {
      const style =
        {
          secondary: ButtonStyle.Secondary,
          success: ButtonStyle.Success,
          danger: ButtonStyle.Danger,
          link: ButtonStyle.Link,
        }[String(b.style || "Primary").toLowerCase()] || ButtonStyle.Primary;
      const builder = new ButtonBuilder()
        .setLabel(trim(b.label || "Button", 80))
        .setStyle(style);
      if (b.emoji) builder.setEmoji(b.emoji);
      const url = safeUrl(b.url);
      if (url) builder.setStyle(ButtonStyle.Link).setURL(url);
      else
        builder.setCustomId(
          b.id || `embed-action:${b.action || "custom"}:${i + offset}`,
        );
      row.addComponents(builder);
    });
    rows.push(row);
  }
  return rows;
}

function buildEmbedPanel(
  interactionOrGuild,
  memberDisplayName = "Unknown User",
) {
  const fake = interactionOrGuild?.guild
    ? interactionOrGuild
    : {
        guild: interactionOrGuild,
        guildId: interactionOrGuild?.id,
        user: { id: "system" },
      };
  return buildEditorPanel(fake, memberDisplayName);
}
function mainEmbed(s, who) {
  return new EmbedBuilder()
    .setColor(s.color || PANEL_COLOR)
    .setTitle("✏️ Embed Studio")
    .setDescription(
      [
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
      ].join("\n"),
    )
    .setFooter({ text: `Requested by ${who}` })
    .setTimestamp();
}
function buildEditorPanel(i, who = "Unknown User") {
  const s = getSession(i);
  return {
    embeds: [mainEmbed(s, who), ...buildPreviewEmbeds(s, i)],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:template")
          .setPlaceholder("🎨 Choose template")
          .addOptions(
            Object.entries(TEMPLATES).map(([value, t]) => ({
              label: t.label,
              value,
              emoji: t.emoji,
              default: s.template === value,
            })),
          ),
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("embed:channel")
          .setPlaceholder("📢 Choose channel")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          ),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:color")
          .setPlaceholder("🌈 Selected panel colour")
          .addOptions([
            ...COLORS.map((c) => ({
              label: c.label,
              value: c.value,
              emoji: c.emoji,
              default: s.color === c.value,
            })),
            {
              label: "Custom HEX",
              value: CUSTOM_HEX_VALUE,
              emoji: "🎨",
              description: "Enter your own HEX colour",
            },
          ]),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:panel-select")
          .setPlaceholder("🧩 Select content panel")
          .addOptions(
            s.panels.map((p, n) => ({
              label: `${n + 1}. ${trim(p.title || p.authorName || "Content Panel", 80)}`,
              value: String(n),
              description: trim(p.description || p.color, 100),
              default: s.selectedPanelIndex === n,
            })),
          ),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("embed:builder")
          .setLabel("🛠️ Builder")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("embed:presets")
          .setLabel("💾 Presets")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("embed:panels")
          .setLabel(`🧩 Panels (${s.panels.length})`)
          .setStyle(ButtonStyle.Primary),  
        new ButtonBuilder()
          .setCustomId("embed:use")
          .setLabel("✅ Use Embed")
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
}
function simplePanel(title, desc, state, who) {
  return new EmbedBuilder()
    .setColor(state.color || PANEL_COLOR)
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: `Requested by ${who}` })
    .setTimestamp();
}
function buildBuilderPanel(i, who = "Unknown User") {
  const s = getSession(i);
  return {
    embeds: [
      simplePanel(
        "🛠️ Embed Builder",
        `Editing panel **${s.selectedPanelIndex + 1}/${s.panels.length}**.`,
        s,
        who,
      ),
      ...buildPreviewEmbeds(s, i),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("embed:edit-content")
          .setLabel("✏️ Content")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("embed:edit-media")
          .setLabel("🖼️ Media")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("embed:fields")
          .setLabel(`📋 Fields (${(s.fields || []).length})`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("embed:buttons")
          .setLabel(`🔘 Buttons (${(s.buttons || []).length})`)
          .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("embed:toggle-ping")
          .setLabel(s.allowUserPing ? "🔔 Ping ON" : "🔕 Ping OFF")
          .setStyle(
            s.allowUserPing ? ButtonStyle.Success : ButtonStyle.Secondary,
          ),
        new ButtonBuilder()
          .setCustomId("embed:toggle-timestamp")
          .setLabel(s.showTimestamp ? "🕒 Timestamp ON" : "🕒 Timestamp OFF")
          .setStyle(
            s.showTimestamp ? ButtonStyle.Success : ButtonStyle.Secondary,
          ),
        new ButtonBuilder()
          .setCustomId("embed:helpers")
          .setLabel("📖 Variables")
          .setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("embed:test-send")
          .setLabel("🧪 Test")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("embed:update-existing")
          .setLabel("♻️ Update Existing")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("embed:reset")
          .setLabel("♻️ Reset")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("embed:back")
          .setLabel("⬅️ Back")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
function buildPanelsPanel(i, who) {
  const s = getSession(i);
  return {
    embeds: [
      simplePanel(
        "🧩 Content Panels",
        `Selected **${s.selectedPanelIndex + 1}/${s.panels.length}**.`,
        s,
        who,
      ),
      ...buildPreviewEmbeds(s, i),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:panel-select")
          .setPlaceholder("🧩 Select panel")
          .addOptions(
            s.panels.map((p, n) => ({
              label: `${n + 1}. ${trim(p.title || "Content Panel", 80)}`,
              value: String(n),
              description: trim(p.description || p.color, 100),
              default: s.selectedPanelIndex === n,
            })),
          ),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("embed:panel-add")
          .setLabel("➕ Add")
          .setStyle(ButtonStyle.Success)
          .setDisabled(s.panels.length >= MAX_PANELS),
        new ButtonBuilder()
          .setCustomId("embed:panel-duplicate")
          .setLabel("📋 Duplicate")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(s.panels.length >= MAX_PANELS),
        new ButtonBuilder()
          .setCustomId("embed:panel-remove")
          .setLabel("🗑️ Remove")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(s.panels.length <= 1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("embed:panel-up")
          .setLabel("⬆️ Up")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(s.selectedPanelIndex <= 0),
        new ButtonBuilder()
          .setCustomId("embed:panel-down")
          .setLabel("⬇️ Down")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(s.selectedPanelIndex >= s.panels.length - 1),
        new ButtonBuilder()
          .setCustomId("embed:builder")
          .setLabel("⬅️ Builder")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
function buildFieldsPanel(i, who) {
  const s = getSession(i),
    rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("embed:field-layout")
        .setPlaceholder("Field Layout")
        .addOptions([
          { label: "Auto", value: "auto", default: (s.fieldLayout || "auto") === "auto" },
          { label: "1 field per row", value: "1", default: s.fieldLayout === "1" },
          { label: "2 fields per row", value: "2", default: s.fieldLayout === "2" },
          { label: "3 fields per row", value: "3", default: s.fieldLayout === "3" },
        ]),
    ),
  );
  if ((s.fields || []).length)
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:field-select")
          .setPlaceholder("📋 Select field")
          .addOptions(
            s.fields.map((f, n) => ({
              label: `${n + 1}. ${trim(f.name || "Field", 80)}`,
              value: String(n),
              description: trim(f.value || "Value", 100),
              default: s.selectedFieldIndex === n,
            })),
          ),
      ),
    );
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("embed:field-add")
        .setLabel("➕ Add")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("embed:field-edit")
        .setLabel("✏️ Edit")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!Number.isInteger(s.selectedFieldIndex)),
      new ButtonBuilder()
        .setCustomId("embed:field-remove-selected")
        .setLabel("🗑️ Remove")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!Number.isInteger(s.selectedFieldIndex)),
      new ButtonBuilder()
        .setCustomId("embed:builder")
        .setLabel("⬅️ Builder")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return {
    embeds: [
      simplePanel(
        "📋 Field Management",
        `Panel ${s.selectedPanelIndex + 1}/${s.panels.length} fields: ${(s.fields || []).length}/25`,
        s,
        who,
      ),
    ],
    components: rows,
  };
}
function buildButtonsPanel(i, who) {
  const s = getSession(i),
    rows = [];
  if ((s.buttons || []).length)
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:button-select")
          .setPlaceholder("🔘 Select button")
          .addOptions(
            s.buttons.map((b, n) => ({
              label: `${n + 1}. ${trim(b.label || "Button", 80)}`,
              value: String(n),
              description: trim(b.url || b.style || "Button", 100),
              default: s.selectedButtonIndex === n,
            })),
          ),
      ),
    );
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("embed:button-add")
        .setLabel("➕ Add")
        .setStyle(ButtonStyle.Success)
        .setDisabled((s.buttons || []).length >= MAX_BUTTONS),
      new ButtonBuilder()
        .setCustomId("embed:button-edit")
        .setLabel("✏️ Edit")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!Number.isInteger(s.selectedButtonIndex)),
      new ButtonBuilder()
        .setCustomId("embed:button-remove-selected")
        .setLabel("🗑️ Remove")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!Number.isInteger(s.selectedButtonIndex)),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("embed:button-move-up")
        .setLabel("⬆️ Up")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(
          !Number.isInteger(s.selectedButtonIndex) ||
            s.selectedButtonIndex <= 0,
        ),
      new ButtonBuilder()
        .setCustomId("embed:button-move-down")
        .setLabel("⬇️ Down")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(
          !Number.isInteger(s.selectedButtonIndex) ||
            s.selectedButtonIndex >= (s.buttons || []).length - 1,
        ),
      new ButtonBuilder()
        .setCustomId("embed:builder")
        .setLabel("⬅️ Builder")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return {
    embeds: [
      simplePanel(
        "🔘 Button Management",
        `Buttons: ${(s.buttons || []).length}/${MAX_BUTTONS}`,
        s,
        who,
      ),
    ],
    components: rows,
  };
}
function buildPresetsPanel(i, who) {
  refreshGuild(i.guild.id);
  const s = getSession(i),
    presets =
      typeof guildManager.getEmbedPresets === "function"
        ? guildManager.getEmbedPresets(i.guild.id) || {}
        : {},
    names = Object.keys(presets).slice(0, 25),
    rows = [];
  if (names.length)
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("embed:preset-select")
          .setPlaceholder("💾 Select preset")
          .addOptions(
            names.map((name) => ({
              label: trim(name, 100),
              value: name,
              description: "Load this preset",
              default: s.selectedPreset === name,
            })),
          ),
      ),
    );
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("embed:preset-save")
        .setLabel("💾 Save")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("embed:preset-delete")
        .setLabel("🗑️ Delete")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!s.selectedPreset),
      new ButtonBuilder()
        .setCustomId("embed:editor")
        .setLabel("⬅️ Back")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return {
    embeds: [
      simplePanel(
        "💾 Embed Presets",
        names.length
          ? `Saved presets: **${names.length}**`
          : "No presets saved yet.",
        s,
        who,
      ),
    ],
    components: rows,
  };
}
function buildHelpersPanel(who) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle("📖 Embed Variables")
        .setDescription(HELPERS.map((h) => `\`${h}\``).join("\n"))
        .setFooter({ text: `Requested by ${who}` })
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("embed:builder")
          .setLabel("⬅️ Back")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
function modal(id, title, inputs) {
  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(
      ...inputs.map((input) => new ActionRowBuilder().addComponents(input)),
    );
}
function input(id, label, style, value = "", required = false, max) {
  const t = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setValue(trim(value, max || 4000));
  if (max) t.setMaxLength(max);
  return t;
}
function contentModal(s) {
  return modal(`embed:save-content:${Date.now()}`, "Edit Panel Text", [
    input("title", "Panel title", TextInputStyle.Short, s.title, false, 256),
    input(
      "description",
      "Panel message/content",
      TextInputStyle.Paragraph,
      s.description,
      false,
      4000,
    ),
    input(
      "authorName",
      "Author name or icon variable",
      TextInputStyle.Short,
      s.authorName,
      false,
      256,
    ),
    input(
      "footer",
      "Footer text or icon variable",
      TextInputStyle.Short,
      s.footer,
      false,
      2048,
    ),
  ]);
}
function mediaModal(s) {
  return modal(`embed:save-media:${Date.now()}`, "Edit Panel Media", [
    input(
      "authorIcon",
      "Author logo URL / variable",
      TextInputStyle.Short,
      s.authorIcon,
    ),
    input(
      "thumbnail",
      "Small thumbnail URL / variable",
      TextInputStyle.Short,
      s.thumbnail,
    ),
    input("image", "Large banner/image URL", TextInputStyle.Short, s.image),
    input(
      "authorUrl",
      "Author clickable URL",
      TextInputStyle.Short,
      s.authorUrl,
    ),
    input(
      "footerIcon",
      "Footer icon URL / variable",
      TextInputStyle.Short,
      s.footerIcon,
    ),
  ]);
}
function fieldModal(s, n = null) {
  const f = Number.isInteger(n) ? s.fields[n] : {};
  return modal(
    Number.isInteger(n) ? `embed:field-save:${n}` : "embed:field-save-new",
    Number.isInteger(n) ? "Edit Field" : "Add Field",
    [
      input("name", "Field name", TextInputStyle.Short, f.name, true, 256),
      input(
        "value",
        "Field value",
        TextInputStyle.Paragraph,
        f.value,
        true,
        1024,
      ),
      input(
        "layout",
        "Inline? yes/no",
        TextInputStyle.Short,
        f.inline ? "yes" : "no",
        false,
        10,
      ),
    ],
  );
}
function buttonModal(s, n = null) {
  const b = Number.isInteger(n) ? s.buttons[n] : { style: "Link" };
  return modal(
    Number.isInteger(n) ? `embed:button-save:${n}` : "embed:button-save-new",
    Number.isInteger(n) ? "Edit Button" : "Add Button",
    [
      input("label", "Button Label", TextInputStyle.Short, b.label, true, 80),
      input("emoji", "Emoji", TextInputStyle.Short, b.emoji, false, 20),
      input("style", "Style", TextInputStyle.Short, b.style || "Link"),
      input("url", "URL", TextInputStyle.Short, b.url),
    ],
  );
}
function colorModal(s) {
  return modal("embed:save-color", "Custom HEX Colour", [
    input(
      "hex",
      "HEX colour",
      TextInputStyle.Short,
      s.color || PANEL_COLOR,
      true,
      7,
    ),
  ]);
}
function presetModal(s) {
  return modal("embed:preset-save-modal", "Save Embed Preset", [
    input(
      "name",
      "Preset name",
      TextInputStyle.Short,
      s.selectedPreset || "",
      true,
      50,
    ),
  ]);
}
async function replyOrUpdate(i, payload) {
  const safePayload = { ...payload, flags: 64 };

  if (i.isModalSubmit()) {
    if (typeof i.update === "function") {
      return i.update(payload);
    }

    if (i.deferred || i.replied) {
      return i.editReply(safePayload);
    }

    return i.reply(safePayload);
  }

  return i.update(payload);
}

async function handleInteraction(i) {
  if (!i.customId?.startsWith("embed:")) return false;
  const who = memberName(i),
    s = getSession(i);
  if (i.isStringSelectMenu()) {
    if (i.customId === "embed:template") {
      applyTemplate(i, i.values[0]);
      return replyOrUpdate(i, buildEditorPanel(i, who));
    }
    if (i.customId === "embed:color") {
      if (i.values[0] === CUSTOM_HEX_VALUE) return i.showModal(colorModal(s));
      markUnsaved(i, saveSelected(s, { color: i.values[0] }));
      return replyOrUpdate(i, buildEditorPanel(i, who));
    }
    if (i.customId === "embed:panel-select") {
      saveSession(i, {
        ...s,
        selectedPanelIndex: Number(i.values[0]),
        selectedFieldIndex: null,
      });
      return replyOrUpdate(i, buildEditorPanel(i, who));
    }
    if (i.customId === "embed:field-layout") {
      markUnsaved(i, { ...s, fieldLayout: i.values[0] });
      return replyOrUpdate(i, buildFieldsPanel(i, who));
    }
    if (i.customId === "embed:field-select") {
      saveSession(i, { ...s, selectedFieldIndex: Number(i.values[0]) });
      return replyOrUpdate(i, buildFieldsPanel(i, who));
    }
    if (i.customId === "embed:button-select") {
      saveSession(i, { ...s, selectedButtonIndex: Number(i.values[0]) });
      return replyOrUpdate(i, buildButtonsPanel(i, who));
    }
    if (i.customId === "embed:preset-select") {
      const preset = guildManager.getEmbedPreset(i.guild.id, i.values[0]);
      if (!preset) return i.reply({ content: "Preset not found.", flags: 64 });
      applyPreset(i, i.values[0], preset);
      return replyOrUpdate(i, buildEditorPanel(i, who));
    }
  }
  if (i.isChannelSelectMenu() && i.customId === "embed:channel") {
    markUnsaved(i, { ...s, channelId: i.values[0] });
    return replyOrUpdate(i, buildEditorPanel(i, who));
  }
  if (i.isButton()) {
    if (i.customId === "embed:back" || i.customId === "embed:editor")
      return i.update(buildEditorPanel(i, who));
    if (i.customId === "embed:builder")
      return i.update(buildBuilderPanel(i, who));
    if (i.customId === "embed:helpers") return i.update(buildHelpersPanel(who));
    if (i.customId === "embed:presets")
      return i.update(buildPresetsPanel(i, who));
    if (i.customId === "embed:panels")
      return i.update(buildPanelsPanel(i, who));
    if (i.customId === "embed:fields")
      return i.update(buildFieldsPanel(i, who));
    if (i.customId === "embed:buttons")
      return i.update(buildButtonsPanel(i, who));
    if (i.customId === "embed:edit-content")
      return i.showModal(contentModal(s));
    if (i.customId === "embed:edit-media") return i.showModal(mediaModal(s));
    if (i.customId === "embed:toggle-ping") {
      markUnsaved(i, { ...s, allowUserPing: !s.allowUserPing });
      return i.update(buildBuilderPanel(i, who));
    }
    if (i.customId === "embed:toggle-timestamp") {
      markUnsaved(i, { ...s, showTimestamp: !s.showTimestamp });
      return i.update(buildBuilderPanel(i, who));
    }
    if (i.customId === "embed:reset") {
      resetSession(i);
      return i.update(buildBuilderPanel(i, who));
    }
    if (i.customId === "embed:panel-add") {
      if (s.panels.length >= MAX_PANELS)
        return i.reply({ content: "Maximum panel limit reached.", flags: 64 });
      const panels = [
        ...s.panels,
        basePanel({
          title: `Panel ${s.panels.length + 1}`,
          description: "Add content here.",
          color: s.color,
        }),
      ];
      markUnsaved(i, {
        ...s,
        panels,
        selectedPanelIndex: panels.length - 1,
        selectedFieldIndex: null,
      });
      return i.update(buildPanelsPanel(i, who));
    }
    if (i.customId === "embed:panel-duplicate") {
      if (s.panels.length >= MAX_PANELS)
        return i.reply({ content: "Maximum panel limit reached.", flags: 64 });
      const panels = [...s.panels];
      panels.splice(
        s.selectedPanelIndex + 1,
        0,
        clone(s.panels[s.selectedPanelIndex]),
      );
      markUnsaved(i, {
        ...s,
        panels,
        selectedPanelIndex: s.selectedPanelIndex + 1,
        selectedFieldIndex: null,
      });
      return i.update(buildPanelsPanel(i, who));
    }
    if (i.customId === "embed:panel-remove") {
      if (s.panels.length <= 1)
        return i.reply({ content: "You need at least one panel.", flags: 64 });
      const panels = [...s.panels];
      panels.splice(s.selectedPanelIndex, 1);
      markUnsaved(i, {
        ...s,
        panels,
        selectedPanelIndex: Math.max(0, s.selectedPanelIndex - 1),
        selectedFieldIndex: null,
      });
      return i.update(buildPanelsPanel(i, who));
    }
    if (i.customId === "embed:panel-up" || i.customId === "embed:panel-down") {
      const d = i.customId.endsWith("up") ? -1 : 1,
        target = s.selectedPanelIndex + d;
      if (target < 0 || target >= s.panels.length) return true;
      const panels = [...s.panels];
      [panels[s.selectedPanelIndex], panels[target]] = [
        panels[target],
        panels[s.selectedPanelIndex],
      ];
      markUnsaved(i, { ...s, panels, selectedPanelIndex: target });
      return i.update(buildPanelsPanel(i, who));
    }
    if (i.customId === "embed:field-add") return i.showModal(fieldModal(s));
    if (i.customId === "embed:field-edit") {
      if (!Number.isInteger(s.selectedFieldIndex))
        return i.reply({ content: "Select a field first.", flags: 64 });
      return i.showModal(fieldModal(s, s.selectedFieldIndex));
    }
    if (i.customId === "embed:field-remove-selected") {
      const fields = [...(s.fields || [])];
      if (Number.isInteger(s.selectedFieldIndex))
        fields.splice(s.selectedFieldIndex, 1);
      markUnsaved(
        i,
        saveSelected({ ...s, selectedFieldIndex: null }, { fields }),
      );
      return i.update(buildFieldsPanel(i, who));
    }
    if (i.customId === "embed:button-add") return i.showModal(buttonModal(s));
    if (i.customId === "embed:button-edit") {
      if (!Number.isInteger(s.selectedButtonIndex))
        return i.reply({ content: "Select a button first.", flags: 64 });
      return i.showModal(buttonModal(s, s.selectedButtonIndex));
    }
    if (i.customId === "embed:button-remove-selected") {
      const buttons = [...(s.buttons || [])];
      if (Number.isInteger(s.selectedButtonIndex))
        buttons.splice(s.selectedButtonIndex, 1);
      markUnsaved(i, { ...s, buttons, selectedButtonIndex: null });
      return i.update(buildButtonsPanel(i, who));
    }
    if (
      i.customId === "embed:button-move-up" ||
      i.customId === "embed:button-move-down"
    ) {
      const d = i.customId.endsWith("up") ? -1 : 1,
        target = s.selectedButtonIndex + d;
      if (
        !Number.isInteger(s.selectedButtonIndex) ||
        target < 0 ||
        target >= (s.buttons || []).length
      )
        return true;
      const buttons = [...s.buttons];
      [buttons[s.selectedButtonIndex], buttons[target]] = [
        buttons[target],
        buttons[s.selectedButtonIndex],
      ];
      markUnsaved(i, { ...s, buttons, selectedButtonIndex: target });
      return i.update(buildButtonsPanel(i, who));
    }
    if (i.customId === "embed:preset-save") return i.showModal(presetModal(s));
    if (i.customId === "embed:preset-delete") {
      const name = s.selectedPreset;
      if (!name)
        return i.reply({ content: "Select a preset first.", flags: 64 });
      const presets =
        typeof guildManager.getEmbedPresets === "function"
          ? guildManager.getEmbedPresets(i.guild.id) || {}
          : {};
      delete presets[name];
      if (typeof guildManager.replaceGuildSection === "function")
        guildManager.replaceGuildSection(i.guild.id, "embedPresets", presets);
      clearUnsaved(i, { ...s, selectedPreset: null });
      return i.update(buildPresetsPanel(i, who));
    }
    if (i.customId === "embed:test-send")
      return i.reply({
        content: "🧪 Test Preview",
        embeds: buildPreviewEmbeds(s, i),
        components: buttonRows(s),
        allowedMentions: allowedMentions(s, i),
        flags: 64,
      });
    if (i.customId === "embed:update-existing") {
      const deployment = getEmbedDeployment(
        i.guild.id,
        getDeploymentKeyFromState(s),
      );
      if (!deployment)
        return i.reply({
          content: "⚠️ No deployed embed found. Use the embed first.",
          flags: 64,
        });
      try {
        const channel = await i.guild.channels.fetch(deployment.channelId);
        const message = await channel.messages.fetch(deployment.messageId);
        await message.edit({
          content: s.allowUserPing ? `<@${i.user.id}>` : "",
          embeds: buildPreviewEmbeds(s, i),
          components: buttonRows(s),
          allowedMentions: allowedMentions(s, i),
        });
        return i.reply({ content: "✅ Existing embed updated.", flags: 64 });
      } catch (error) {
        console.error("Failed to update existing embed:", error);
        return i.reply({
          content: "⚠️ Original embed not found, or I cannot edit it.",
          flags: 64,
        });
      }
    }
    if (i.customId === "embed:use") {
      const channel =
        i.guild.channels.cache.get(s.channelId) ||
        (await i.guild.channels.fetch(s.channelId).catch(() => null));
      if (!channel?.isTextBased())
        return i.reply({ content: "Invalid channel.", flags: 64 });
      let sent;
      try {
        sent = await channel.send({
          content: s.allowUserPing ? `<@${i.user.id}>` : "",
          embeds: buildPreviewEmbeds(s, i),
          components: buttonRows(s),
          allowedMentions: allowedMentions(s, i),
        });
      } catch (error) {
        console.error("Embed send failed:", error);
        return i.reply({
          content:
            "❌ I cannot send messages to that channel. Check Send Messages, Embed Links and View Channel permissions.",
          flags: 64,
        });
      }
      const presetName = `auto-${s.template || "custom"}`;
      guildManager.saveEmbedPreset(
        i.guild.id,
        presetName,
        presetData(s),
        i.guild,
      );
      saveEmbedDeployment(
        i.guild.id,
        getDeploymentKeyFromState({ ...s, selectedPreset: presetName }),
        {
          channelId: channel.id,
          messageId: sent.id,
          template: s.template,
          preset: presetName,
          createdBy: i.user.id,
          lastUpdatedBy: i.user.id,
        },
      );
      const ok = setDefault(i.guild.id, s.template, presetName);
      clearUnsaved(i, { ...s, selectedPreset: presetName });
      return i.reply({
        content: ok
          ? `✅ Embed posted to <#${s.channelId}> and saved as active`
          : "⚠️ Preset saved, but default assignment failed.",
        flags: 64,
      });
    }
  }
  if (i.isModalSubmit()) {
    if (i.customId === "embed:preset-save-modal") {
      const name = i.fields.getTextInputValue("name").trim();
      if (!name) return i.reply({ content: "Name required.", flags: 64 });
      guildManager.saveEmbedPreset(i.guild.id, name, presetData(s), i.guild);
      clearUnsaved(i, { ...s, selectedPreset: name });
      return i.reply({ ...buildPresetsPanel(i, who), flags: 64 });
    }
    if (i.customId === "embed:save-color") {
      const hex = i.fields.getTextInputValue("hex");
      if (!validHex(hex))
        return i.reply({ content: "Invalid HEX.", flags: 64 });
      markUnsaved(i, saveSelected(s, { color: normHex(hex) }));
      return i.reply({ ...buildEditorPanel(i, who), flags: 64 });
    }
    if (i.customId.startsWith("embed:save-content:")) {
      markUnsaved(
        i,
        saveSelected(s, {
          title: i.fields.getTextInputValue("title"),
          description: i.fields.getTextInputValue("description"),
          authorName: i.fields.getTextInputValue("authorName"),
          footer: i.fields.getTextInputValue("footer"),
        }),
      );
      return i.reply({ ...buildBuilderPanel(i, who), flags: 64 });
    }
    if (i.customId.startsWith("embed:save-media:")) {
      markUnsaved(
        i,
        saveSelected(s, {
          authorIcon: i.fields.getTextInputValue("authorIcon"),
          thumbnail: i.fields.getTextInputValue("thumbnail"),
          image: i.fields.getTextInputValue("image"),
          authorUrl: i.fields.getTextInputValue("authorUrl"),
          footerIcon: i.fields.getTextInputValue("footerIcon"),
        }),
      );
      return i.reply({ ...buildBuilderPanel(i, who), flags: 64 });
    }
    if (
      i.customId === "embed:field-save-new" ||
      i.customId.startsWith("embed:field-save:")
    ) {
      const n = i.customId.startsWith("embed:field-save:")
        ? Number(i.customId.split(":")[2])
        : null;
      const fields = [...(s.fields || [])];
      const f = {
        name: i.fields.getTextInputValue("name"),
        value: i.fields.getTextInputValue("value"),
        inline: /^y(es)?|true|1$/i.test(
          i.fields.getTextInputValue("layout") || "",
        ),
      };
      if (Number.isInteger(n)) fields[n] = f;
      else fields.push(f);
      markUnsaved(i, {
        ...saveSelected(s, { fields }),
        selectedFieldIndex: Number.isInteger(n) ? n : fields.length - 1,
      });
      return i.reply({ ...buildFieldsPanel(i, who), flags: 64 });
    }
    if (
      i.customId === "embed:button-save-new" ||
      i.customId.startsWith("embed:button-save:")
    ) {
      const n = i.customId.startsWith("embed:button-save:")
        ? Number(i.customId.split(":")[2])
        : null;
      const style = i.fields.getTextInputValue("style") || "Link";
      const url = i.fields.getTextInputValue("url");
      if (String(style).toLowerCase() === "link" && !safeUrl(url))
        return i.reply({
          content: "⚠️ Link buttons require a valid URL.",
          flags: 64,
        });
      const buttons = [...(s.buttons || [])];
      const b = {
        label: i.fields.getTextInputValue("label"),
        emoji: i.fields.getTextInputValue("emoji"),
        style,
        action: "link",
        url,
      };
      if (Number.isInteger(n)) buttons[n] = b;
      else buttons.push(b);
      markUnsaved(i, {
        ...s,
        buttons,
        selectedButtonIndex: Number.isInteger(n) ? n : buttons.length - 1,
      });
      return i.reply({ ...buildButtonsPanel(i, who), flags: 64 });
    }
  }
  return false;
}

module.exports = {
  buildEmbedPanel,
  handleInteraction,
  buildPreviewEmbed,
  buildPreviewEmbeds,
  TEMPLATES,
};
