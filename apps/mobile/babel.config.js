module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo wires the Reanimated/Worklets plugin automatically.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
