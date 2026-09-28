import apiClient from './client'

export interface StorageTableStats {
  count: number
  estimated_bytes: number
  /** embeddings only: average vector width */
  dimensions?: number
}

export interface StorageDiskSection {
  bytes: number
  files: number
}

export interface StorageExportEstimate {
  basis: 'last_package' | 'estimated'
  estimated_bytes: number
}

export interface StorageSummary {
  database: {
    sources: StorageTableStats
    insights: StorageTableStats
    notes: StorageTableStats
    embeddings: StorageTableStats
    estimated_bytes: number
  }
  disk: {
    root: string
    total_bytes: number
    sections: Record<string, StorageDiskSection>
  }
  export_estimate: StorageExportEstimate
  totals: {
    database_bytes: number
    disk_bytes: number
  }
}

export const storageApi = {
  summary: async (): Promise<StorageSummary> => {
    const response = await apiClient.get<StorageSummary>('/storage/summary')
    return response.data
  },
}
