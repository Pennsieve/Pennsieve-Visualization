import type { Ref } from 'vue'

export interface DuckDBStoreInterface {
  // State
  isReady: Ref<boolean> | boolean

  // Core methods
  createConnection(viewerId?: string): Promise<{ connection: any, connectionId: string }>
  closeConnection(connectionId: string): Promise<void>
  loadFile(
    fileUrl: string,
    fileType: 'csv' | 'parquet',
    tableName?: string,
    csvOptions?: object,
    viewerId?: string,
    fileId?: string
  ): Promise<string>
  executeQuery(query: string, connectionId: string): Promise<any[]>

  // Cross-component shared results
  sharedResultName: Ref<string | null> | string | null
  sharedVersion: Ref<number> | number
  publishViewFromQuery(name: string, sql: string, connectionId: string): Promise<void>

  // Utilities
  formatIdFromUrl(srcUrl: string): string
}
