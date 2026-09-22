import { expect, test } from 'vite-plus/test'
import { readFileSync } from 'node:fs'

test('the project does not install a package-manager shim', () => {
  expect(JSON.parse(readFileSync('package.json', 'utf8'))).not.toHaveProperty('devEngines')
})
