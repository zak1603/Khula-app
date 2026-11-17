// Expo SDK 52+ auto-detects npm workspaces (watchFolders / nodeModulesPaths),
// so @khula/shared is consumed straight from TypeScript source.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
