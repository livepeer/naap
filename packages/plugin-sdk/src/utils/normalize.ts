/**
 * Plugin name normalization utilities.
 *
 * Provides a canonical form for plugin names so that lookup/comparison is
 * resilient to common naming variations (e.g. "my-plugin" vs "myPlugin" vs
 * "my_plugin").
 */

/**
 * Normalize a plugin name for comparison by lowercasing and stripping
 * hyphens / underscores.
 *
 * @example
 *   normalizePluginName('my-plugin')  // "myplugin"
 *   normalizePluginName('myPlugin')   // "myplugin"
 *   normalizePluginName('MY_PLUGIN')  // "myplugin"
 */
export function normalizePluginName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '');
}
