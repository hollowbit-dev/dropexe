// One-click game stores. Each store gets its own bottle so they never break each other.
// `works` is shown on the card in plain words; keep it honest.
module.exports = [
  {
    id: 'steam', name: 'Steam', color: '#1b9cf2', works: 'Works great',
    installer: { url: 'https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe', file: 'SteamSetup.exe', args: ['/S'] },
    exe: 'C:\\Program Files (x86)\\Steam\\steam.exe',
    args: [],
    engine: 'wine10', // Steam's window is black on Wine 11 (tested 24 Nov 2026)
    fix: { graphics: 'wined3d' },
  },
  {
    id: 'epic', name: 'Epic Games', color: '#e6e6e6', works: 'Works',
    tested: 'Opens and updates itself. Uses Vulkan graphics.',
    // Its installer's telemetry step hangs forever under Wine's .NET, so .NET is switched off while it installs.
    installer: { url: 'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi', file: 'EpicInstaller.msi', msi: true, overrides: 'mscoree=d' },
    exe: 'C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe',
    args: ['-SkipBuildPatchPrereq'],
    fix: { graphics: 'dxvk' }, // Metal graphics crash its window; Vulkan works (tested 24 Nov 2026)
  },
  {
    id: 'gog', name: 'GOG Galaxy', color: '#a65cff', works: 'Click through its installer',
    installer: { url: 'https://webinstallers.gog-statics.com/download/GOG_Galaxy_2.0.exe', file: 'GOG_Galaxy_2.0.exe', args: [] },
    exe: 'C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe',
    args: [],
    fix: { graphics: 'dxmt' },
  },
  {
    id: 'battlenet', name: 'Battle.net', color: '#148eff', works: 'Click through its installer',
    installer: { url: 'https://downloader.battle.net/download/getInstaller?os=win&installer=Battle.net-Setup.exe', file: 'Battle.net-Setup.exe', args: [] },
    exe: 'C:\\Program Files (x86)\\Battle.net\\Battle.net Launcher.exe',
    args: [],
    fix: { graphics: 'dxmt' },
  },
  {
    id: 'ubisoft', name: 'Ubisoft Connect', color: '#2f6bff', works: 'Not working yet', broken: "Ubisoft Connect says it isn't compatible with this version of Windows.",
    installer: { url: 'https://static3.cdn.ubi.com/orbit/launcher_installer/UbisoftConnectInstaller.exe', file: 'UbisoftConnectInstaller.exe', args: ['/S'] },
    exe: 'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\UbisoftConnect.exe',
    args: [],
    fix: { graphics: 'dxmt' },
  },
  {
    id: 'ea', name: 'EA app', color: '#ff4747', works: 'Not working yet', broken: "The EA app's installer stops with error FA-1135.",
    installer: { url: 'https://origin-a.akamaihd.net/EA-Desktop-Client-Download/installer-releases/EAappInstaller.exe', file: 'EAappInstaller.exe', args: [] },
    exe: 'C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EALauncher.exe',
    args: [],
    fix: { graphics: 'dxmt' },
  },
];
