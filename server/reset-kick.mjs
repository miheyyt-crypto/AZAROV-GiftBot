/**
 * CLI: wipe all Kick bindings from the JSON store.
 *
 * Local:
 *   node server/reset-kick.mjs
 *
 * Railway Volume:
 *   AZAROV_STORE_DIR=/data node server/reset-kick.mjs
 */
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resetAllKickBindingsOnStore } from './kick-reset.mjs'
import { withStore } from './store.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: path.join(rootDir, '.env') })

const result = withStore((store) => resetAllKickBindingsOnStore(store))

console.info('[kick-reset] done', result)
