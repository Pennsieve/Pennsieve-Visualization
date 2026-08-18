// @/composables/useChannelProcessing.ts
import { computed, reactive, ref, watch, readonly } from 'vue'
import type { Ref } from 'vue'
import type { ChannelDetail } from './streaming/channelDetails'

export interface MontageChannelPair {
    name?: string
    channels: string[]
}

// TODO(ts-3c): replace with the store type once stores/tsviewer converts
export interface WorkspaceMontage {
    name: string
    channelPairs: MontageChannelPair[]
}

/** Envelope `createVirtualChannel` builds around a base channel. */
export interface VirtualChannelContent {
    id: string
    serverId: string
    name: string
    channelType: string
    label: string
    displayName: string
    unit: string
    rate: number
    start: number
    end: number
    montageScheme: string
    isMontaged: boolean
    baseChannelId: string
}

export interface VirtualChannel {
    content: VirtualChannelContent
    properties: unknown[]
}

/** Store channel entry `createChannelConfig` returns. */
export interface ChannelConfig {
    id: string
    serverId: string
    type: string
    label: string
    displayName: string
    labelParts: string[]
    labelPrefix: string
    labelValue: string | number
    dataSegments: number[]
    rank: number
    visible: boolean
    plotAgainst: unknown
    rowBaseline: number | null
    rowScale: number
    rowAdjust: number
    selected: boolean
    hover: boolean
    unit: string
    sf: number
    filter: Record<string, unknown>
    hideFilter: boolean
    isEditing: boolean
    montageScheme: string
    isMontaged: boolean
    baseChannelId: string
}

export const useChannelProcessing = (baseChannels: Ref<ChannelDetail[] | undefined>, viewerMontageScheme: Ref<string>, workspaceMontages: Ref<WorkspaceMontage[]>, activeViewer: Ref<{ content: { id: string } } | null | undefined>) => {    // Processing state
    const processingStats = reactive({
        totalChannels: 0,
        processedChannels: 0,
        montageChannels: 0,
        errors: 0,
        lastProcessingTime: 0
    })

    // Channel cache for performance
    const channelCache = ref(new Map<string, ChannelDetail>())
    const montageCache = ref(new Map<string, string>())

    // Computed properties
    const isViewingMontage = computed(() =>
        viewerMontageScheme.value !== 'NOT_MONTAGED'
    )

    const currentMontage = computed(() => {
        if (!isViewingMontage.value || !workspaceMontages.value) {
            return null
        }
        return workspaceMontages.value.find(m => m.name === viewerMontageScheme.value)
    })

    const montageChannelPairs = computed(() => {
        return currentMontage.value?.channelPairs || {}
    })

    // Clear caches when montage changes
    watch(viewerMontageScheme, () => {
        channelCache.value.clear()
        montageCache.value.clear()
    })

    /**
     * Extract channel ID from channel object
     * Handles montage channel IDs by removing montage suffixes
     */
    const getChannelId = (channel: { id?: string } | null | undefined) => {
        if (!channel) return ''
        // Use the id field (which is unique for client-side)
        return channel?.id ?? ''
    }

    const getServerChannelId = (channel: { id?: string; serverId?: string } | null | undefined) => {
        if (!channel) return ''
        return (channel?.serverId ?? '') || (channel?.id ?? '')
    }

    /**
     * Get clean channel identifier without montage modifications
     */
    const getRawChannelId = (channel: { id?: string } | null | undefined) => {
        return channel?.id ?? ''
    }
    /**
     * Get base channel identifier (strips montage suffix)
     * Use this for grouping/display purposes only
     */
    const getBaseChannelId = (channel: { id?: string } | null | undefined) => {
        if (!channel) return ''

        let id = channel?.id ?? ''

        // Handle montage IDs - remove channel name suffix for montaged channels
        if (isViewingMontage.value && typeof id === 'string') {
            const parts = id.split('_')
            id = parts.length > 1 ? parts[0] : id
        }

        return id
    }

    /**
     * Generate display name for montaged channels
     * Falls back to simple concatenation if montage definition not found
     */
    const getDisplayName = (channel1: string, channel2: string, montageName: string | null = null) => {
        const montageToUse = montageName || viewerMontageScheme.value

        // Check cache first
        const cacheKey = `${channel1}_${channel2}_${montageToUse}`
        if (montageCache.value.has(cacheKey)) {
            return montageCache.value.get(cacheKey)!
        }

        let displayName = `${channel1}-${channel2}` // Default fallback

        if (montageToUse !== 'NOT_MONTAGED') {
            const montage = workspaceMontages.value?.find(m => m.name === montageToUse)

            if (montage?.channelPairs) {
                // Search through channel pairs for matching channels
                for (const pairKey of Object.keys(montage.channelPairs)) {
                    const pair = montage.channelPairs[pairKey as unknown as number]

                    if (pair.channels?.length === 2 &&
                        pair.channels[0] === channel1 &&
                        pair.channels[1] === channel2) {
                        displayName = pair.name || displayName
                        break
                    }
                }
            }
        }

        // Cache the result
        montageCache.value.set(cacheKey, displayName)
        return displayName
    }

    /**
     * Process channel details from WebSocket into virtual channel objects
     */
    const processChannelData = (channelDetails: Pick<ChannelDetail, 'id' | 'name'>[] | null | undefined) => {
        if (!Array.isArray(channelDetails)) {
            console.warn('Invalid channel details provided:', channelDetails)
            return []
        }

        const startTime = performance.now()
        processingStats.totalChannels = channelDetails.length
        processingStats.processedChannels = 0
        processingStats.errors = 0

        const virtualChannels = channelDetails.map(({ id, name }) => {
            try {
                const baseChannel = findBaseChannel(id)
                if (!baseChannel) {
                    console.warn(`Base channel not found for ID: ${id}, available base channels:`,
                        baseChannels.value?.map(ch => ({ id: ch?.id, name: ch?.name })) || []
                    )
                    processingStats.errors++
                    return null
                }

                const virtualChannel = createVirtualChannel(id, name, baseChannel)
                processingStats.processedChannels++

                if (isViewingMontage.value) {
                    processingStats.montageChannels++
                }

                return virtualChannel
            } catch (error) {
                console.error(`Error processing channel ${id}:`, error)
                processingStats.errors++
                return null
            }
        }).filter(Boolean)

        processingStats.lastProcessingTime = performance.now() - startTime

        return virtualChannels
    }

    /**
     * Find base channel by ID from the provided base channels
     */
    const findBaseChannel = (channelId: string) => {
        // Check cache first
        if (channelCache.value.has(channelId)) {
            return channelCache.value.get(channelId)
        }

        const baseChannel = baseChannels.value?.find(ch => ch?.id === channelId)

        if (baseChannel) {
            channelCache.value.set(channelId, baseChannel)
        }

        return baseChannel
    }

    /**
     * Create virtual channel object from base channel and montage info
     */
    const createVirtualChannel = (id: string, name: string, baseChannel: ChannelDetail): VirtualChannel => {
        let displayName = name

        // serverId is what server provided (the 'id' parameter)
        const serverId = id

        // For client-side, create unique id
        let uniqueId = id  // Default to server ID

        if (isViewingMontage.value) {
            // Create unique client-side ID for montaged channels
            uniqueId = `${id}_${name}`

            const channelParts = name.split("<->", 2)
            if (channelParts.length === 2) {
                displayName = getDisplayName(channelParts[0], channelParts[1])
            }
        }

        const content = {
            id: uniqueId,            // unique client-side id
            serverId: serverId,      // id the server provided and expects back
            name,
            channelType: baseChannel.channelType,
            label: name,
            displayName,
            unit: baseChannel.unit,
            rate: baseChannel.rate,
            start: baseChannel.start,
            end: baseChannel.end,
            // Additional metadata
            montageScheme: isViewingMontage.value ? viewerMontageScheme.value : 'NOT_MONTAGED',
            isMontaged: isViewingMontage.value,
            baseChannelId: id  // Keep reference for debugging
        }

        return {
            content,
            properties: baseChannel.properties || []
        }
    }

    /**
     * Create montage payload for WebSocket messages
     */
    const createMontagePayload = (montageSchemeName: string) => {
        // Handle the default "NOT_MONTAGED" case
        if (montageSchemeName === "NOT_MONTAGED") {
            return {
                montage: "NOT_MONTAGED",
                packageId: activeViewer.value?.content?.id,
                montageMap: []
            }
        }

        // Find the selected montage by name
        const selectedMontage = workspaceMontages.value.find(m => m.name === montageSchemeName)

        if (!selectedMontage) {
            console.warn('Montage not found:', montageSchemeName)
            return null
        }

        // Convert channelPairs to the array format the server expects
        const montageMap = selectedMontage.channelPairs.map(pair => pair.channels)

        return {
            montage: "CUSTOM_MONTAGE",
            packageId: activeViewer.value?.content.id,
            montageMap: montageMap
        }
    }

    /**
     * Validate channel configuration
     */
    const validateChannelConfig = (channelConfig: { id?: unknown; label?: unknown; type?: string; unit?: unknown; rate?: number; start?: number; end?: number } | null | undefined) => {
        const errors = []

        if (!channelConfig) {
            errors.push('Channel configuration is null or undefined')
            return { isValid: false, errors }
        }

        // Required fields
        const requiredFields = ['id', 'label', 'type', 'unit', 'rate'] as const
        for (const field of requiredFields) {
            if (!channelConfig[field]) {
                errors.push(`Missing required field: ${field}`)
            }
        }

        // Validate data types
        if (channelConfig.rate && (typeof channelConfig.rate !== 'number' || channelConfig.rate <= 0)) {
            errors.push('Sample rate must be a positive number')
        }

        if (channelConfig.start && channelConfig.end && channelConfig.start >= channelConfig.end) {
            errors.push('Channel start time must be less than end time')
        }

        // Validate channel type
        const validTypes = ['CONTINUOUS', 'UNIT', 'Neural']
        if (channelConfig.type && !validTypes.includes(channelConfig.type)) {
            errors.push(`Invalid channel type: ${channelConfig.type}. Must be one of: ${validTypes.join(', ')}`)
        }

        return {
            isValid: errors.length === 0,
            errors
        }
    }

    /**
     * Process and sort channel configurations
     */
    const sortChannelConfigurations = (channelConfigs: ChannelConfig[]) => {
        return channelConfigs.sort((a, b) => {
            const aLabel = a.label || ''
            const bLabel = b.label || ''

            // Split labels for smart sorting
            const aParts = aLabel.split('<->', 3)
            const bParts = bLabel.split('<->', 3)

            // If either has more than 2 parts, fall back to string comparison
            if (aParts.length > 2 || bParts.length > 2) {
                return aLabel.localeCompare(bLabel)
            }

            const aPrefix = aParts[0] || ''
            const bPrefix = bParts[0] || ''

            // If prefixes are the same, sort by numeric value
            if (aPrefix === bPrefix && aParts.length > 1 && bParts.length > 1) {
                const aValue = parseFloat(aParts[1])
                const bValue = parseFloat(bParts[1])

                if (!isNaN(aValue) && !isNaN(bValue)) {
                    return aValue - bValue
                }

                // If not numeric, sort as strings
                return aParts[1].localeCompare(bParts[1])
            }

            // Sort by prefix
            return aPrefix.localeCompare(bPrefix)
        })
    }

    /**
     * Create channel configuration object
     */
    const createChannelConfig = (virtualChannel: VirtualChannel, rank = 0): ChannelConfig => {
        const content = virtualChannel.content
        const labelParts = content.label.split('<->', 3)
        const labelPrefix = labelParts[0] || ''
        const labelValue = labelParts.length > 1
            ? (isNaN(parseFloat(labelParts[1])) ? labelParts[1] : parseFloat(labelParts[1]))
            : 0

        return {
            id: content.id,
            serverId: content.serverId,
            type: content.channelType,
            label: content.label,
            displayName: content.displayName,
            labelParts,
            labelPrefix,
            labelValue,
            dataSegments: [],
            rank,
            visible: true,
            plotAgainst: null,
            rowBaseline: null,
            rowScale: 1,
            rowAdjust: 0,
            selected: false,
            hover: false,
            unit: content.unit,
            sf: content.rate,
            filter: {},
            hideFilter: true,
            isEditing: false,
            montageScheme: content.montageScheme || 'NOT_MONTAGED',
            isMontaged: content.isMontaged || false,
            baseChannelId: content.baseChannelId  // For debugging/reference
        }
    }

    /**
     * Filter channels based on criteria
     */
    const filterChannels = (channels: ChannelConfig[], criteria: { channelType?: string | null; visible?: boolean | null; montageScheme?: string | null; labelPattern?: string | null; sampleRate?: number | null } = {}) => {
        const {
            channelType = null,
            visible = null,
            montageScheme = null,
            labelPattern = null,
            sampleRate = null
        } = criteria

        return channels.filter(channel => {
            // Filter by channel type
            if (channelType && channel.type !== channelType) {
                return false
            }

            // Filter by visibility
            if (visible !== null && channel.visible !== visible) {
                return false
            }

            // Filter by montage scheme
            if (montageScheme && channel.montageScheme !== montageScheme) {
                return false
            }

            // Filter by label pattern (regex)
            if (labelPattern) {
                const regex = new RegExp(labelPattern, 'i')
                if (!regex.test(channel.label)) {
                    return false
                }
            }

            // Filter by sample rate
            if (sampleRate && channel.sf !== sampleRate) {
                return false
            }

            return true
        })
    }

    /**
     * Group channels by various criteria
     */
    const groupChannels = (channels: ChannelConfig[], groupBy = 'type') => {
        const groups: Record<string, ChannelConfig[]> = {}

        channels.forEach(channel => {
            let groupKey

            switch (groupBy) {
                case 'type':
                    groupKey = channel.type
                    break
                case 'montage':
                    groupKey = channel.montageScheme || 'NOT_MONTAGED'
                    break
                case 'prefix':
                    groupKey = channel.labelPrefix
                    break
                case 'sampleRate':
                    groupKey = channel.sf
                    break
                case 'unit':
                    groupKey = channel.unit
                    break
                default:
                    groupKey = 'all'
            }

            if (!groups[groupKey]) {
                groups[groupKey] = []
            }
            groups[groupKey].push(channel)
        })

        return groups
    }

    /**
     * Get channel processing statistics
     */
    const getProcessingStats = () => ({
        ...processingStats,
        cacheSize: channelCache.value.size,
        montageCacheSize: montageCache.value.size,
        isViewingMontage: isViewingMontage.value,
        currentMontageScheme: viewerMontageScheme.value,
        availableMontages: workspaceMontages.value?.map(m => m.name) || []
    })

    /**
     * Clear all caches
     */
    const clearCaches = () => {
        channelCache.value.clear()
        montageCache.value.clear()

        // Reset stats
        Object.assign(processingStats, {
            totalChannels: 0,
            processedChannels: 0,
            montageChannels: 0,
            errors: 0,
            lastProcessingTime: 0
        })
    }

    /**
     * Batch process multiple channel operations
     */
    const batchProcessChannels = async (operations: Array<() => unknown>) => {
        const results: { success: boolean; result?: unknown; error?: string }[] = []

        for (const operation of operations) {
            try {
                const result = await operation()
                results.push({ success: true, result })
            } catch (error) {
                results.push({ success: false, error: (error as Error).message })
                processingStats.errors++
            }
        }

        return results
    }

    return {
        // State
        processingStats: readonly(processingStats),
        isViewingMontage,
        currentMontage,
        montageChannelPairs,

        // Core processing methods
        getChannelId,
        getBaseChannelId,
        getServerChannelId,
        getRawChannelId,
        getDisplayName,
        processChannelData,
        createMontagePayload,

        // Channel configuration
        createChannelConfig,
        validateChannelConfig,
        sortChannelConfigurations,

        // Utility methods
        filterChannels,
        groupChannels,
        findBaseChannel,
        createVirtualChannel,

        // Management
        getProcessingStats,
        clearCaches,
        batchProcessChannels
    }
}