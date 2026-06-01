// Metro config for the Expo app inside the pnpm monorepo.
//
// pnpm symlinks workspace packages (e.g. @area-code/shared) and hoists most
// deps to the repo-root node_modules. Metro must therefore watch the repo root
// and resolve modules from both the app-local and root node_modules folders.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch all files in the monorepo so changes to packages/shared hot-reload.
config.watchFolders = [workspaceRoot]

// 2. Resolve modules from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// 3. pnpm uses symlinks; let Metro follow them.
config.resolver.unstable_enableSymlinks = true
config.resolver.disableHierarchicalLookup = false

module.exports = config
