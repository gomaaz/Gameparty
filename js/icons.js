// Centralized SVG icon management
// Maps icon keys to their SVG file names
const ICON_FILES = {
    steam: 'steam.svg',
    ubisoft: 'ubisoft.svg',
    battlenet: 'battledotnet.svg',
    epic: 'epicgames.svg',
    ea: 'ea.svg',
    riot: 'riotgames.svg',
    discord: 'discord.svg',
    teamspeak: 'teamspeak.svg',
};

// Helper function to create SVG icon HTML from file
function createIconSvg(iconKey, size = '14px') {
    const filename = ICON_FILES[iconKey];
    if (!filename) return '';
    return `<img src="svg/${filename}" style="width:${size};height:${size};vertical-align:middle;display:inline-block" alt="${iconKey}" />`;
}
