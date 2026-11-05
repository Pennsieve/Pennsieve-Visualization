// vitest globalSetup: the bundle tests need the reader's fixture on disk before any
// worker starts. See scripts/reader-fixture.mjs.
import { ensureFixture } from '../../../../scripts/reader-fixture.mjs'

export default async function setup(): Promise<void> {
    await ensureFixture()
}
