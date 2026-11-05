/** Version of the reader installed for packages/ts-viewer. */
export function readerVersion(): string
/** Where the fixture for the installed reader lives once fetched. */
export function fixtureRoot(): string
/** Fetches the fixture for the installed reader unless it is already cached. */
export function ensureFixture(): Promise<string>
