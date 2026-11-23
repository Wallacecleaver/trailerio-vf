const FRENCH_LANGUAGES = /^(?:fr|fra|fre)(?:-[a-z0-9]+)*$/i;

function parseAttributes(line) {
  return new Map(
    Array.from(line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]+)/g), ([, name, value]) => [name, value])
  );
}

function attribute(attributes, name) {
  return attributes.get(name)?.replace(/^"|"$/g, '');
}

function formatAttributes(attributes) {
  return Array.from(attributes, ([name, value]) => `${name}=${value}`).join(',');
}

function appleMediaUrl(value, baseUrl) {
  if (!value || value.startsWith('#') || value.includes('{$')) return null;

  try {
    const url = new URL(value, baseUrl);
    const appleHost = url.hostname.endsWith('.tv.apple.com') || url.hostname.endsWith('.itunes.apple.com');
    if (appleHost && url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    return null;
  }
  return null;
}

export function frenchApplePlaylist(playlist, baseUrl) {
  const lines = playlist.trim().split(/\r?\n/);
  if (lines[0] !== '#EXTM3U' || lines.some(line => line.startsWith('#EXT-X-SESSION-KEY:'))) return null;

  const audio = new Map();
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;

    const attributes = parseAttributes(line);
    const language = attribute(attributes, 'LANGUAGE');
    const group = attribute(attributes, 'GROUP-ID');
    const uri = appleMediaUrl(attribute(attributes, 'URI'), baseUrl);
    if (attribute(attributes, 'TYPE') !== 'AUDIO' || !FRENCH_LANGUAGES.test(language) || !group || !uri) continue;

    const descriptions = attribute(attributes, 'CHARACTERISTICS')?.includes('public.accessibility.describes-video');
    if (descriptions) continue;

    const rank = /^(?:fr|fra|fre)-FR$/i.test(language) ? 2 : 1;
    if ((audio.get(group)?.rank ?? 0) >= rank) continue;

    attributes.set('URI', `"${uri}"`);
    attributes.set('DEFAULT', 'YES');
    attributes.set('AUTOSELECT', 'YES');
    attributes.delete('PATHWAY-ID');
    attributes.delete('STABLE-RENDITION-ID');
    audio.set(group, { rank, attributes });
  }

  const variants = [];
  const groups = new Set();
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const attributes = parseAttributes(line);
    const group = attribute(attributes, 'AUDIO');
    const uri = appleMediaUrl(lines[index + 1]?.trim(), baseUrl);
    if (!audio.has(group) || !uri || !attributes.has('BANDWIDTH') || attributes.has('VIDEO')) continue;

    attributes.delete('SUBTITLES');
    attributes.delete('CLOSED-CAPTIONS');
    attributes.delete('PATHWAY-ID');
    attributes.delete('STABLE-VARIANT-ID');
    variants.push(`#EXT-X-STREAM-INF:${formatAttributes(attributes)}`, uri);
    groups.add(group);
  }
  if (variants.length === 0) return null;

  const header = lines.filter(line => /^#EXT-X-VERSION:\d+$/.test(line) || line === '#EXT-X-INDEPENDENT-SEGMENTS');
  const renditions = Array.from(groups, group => `#EXT-X-MEDIA:${formatAttributes(audio.get(group).attributes)}`);
  return ['#EXTM3U', ...header, ...renditions, ...variants, ''].join('\n');
}
