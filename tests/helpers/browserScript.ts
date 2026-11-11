import path = require('node:path')
import { ROOT_PATH } from '../../src/config/path'

/** Browser bundles differ from the CommonJS modules imported by the Node tests. */
export function browserScript(name: 'markdown' | 'component-markdown' | 'template-document' | 'template-layout'): string {
 return path.join(ROOT_PATH, 'dist', 'browser', name + '.js')
}
