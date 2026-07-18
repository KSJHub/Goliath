'use strict';

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function objectValue(value, ...keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return firstString(...keys.map((key) => value[key]));
}

function normalizePanelEmbed(embed = {}, fallbacks = {}) {
  const source = embed && typeof embed === 'object' && !Array.isArray(embed) ? embed : {};
  const author = source.author && typeof source.author === 'object' ? source.author : {};
  const footer = source.footer && typeof source.footer === 'object' ? source.footer : {};
  const thumbnail = source.thumbnail && typeof source.thumbnail === 'object' ? source.thumbnail : {};
  const image = source.image && typeof source.image === 'object' ? source.image : {};

  return {
    ...source,
    title: firstString(source.title),
    description: firstString(source.description),
    authorName: firstString(source.authorName, author.name),
    authorIcon: firstString(source.authorIcon, author.iconURL, author.icon_url),
    authorUrl: firstString(source.authorUrl, author.url),
    footer: firstString(
      typeof source.footer === 'string' ? source.footer : '',
      footer.text,
      fallbacks.footer,
    ),
    footerIcon: firstString(source.footerIcon, footer.iconURL, footer.icon_url),
    thumbnail: firstString(
      typeof source.thumbnail === 'string' ? source.thumbnail : '',
      source.thumbnailURL,
      thumbnail.url,
      fallbacks.thumbnail,
    ),
    image: firstString(
      typeof source.image === 'string' ? source.image : '',
      source.imageURL,
      image.url,
      fallbacks.image,
    ),
    fields: Array.isArray(source.fields) ? source.fields : [],
  };
}

module.exports = {
  firstString,
  normalizePanelEmbed,
};
